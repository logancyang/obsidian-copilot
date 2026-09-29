import type { AgentProjectContextLoadState, FailedItem } from "@/aiParams";
import { EMPTY_PROCESSING_SOURCES, EMPTY_RETRYING_SOURCES } from "@/aiParams";
import {
  processingItemEnvelope,
  type ProcessingItem,
} from "@/components/project/processingAdapter";
import {
  cacheFileName,
  failureMarkerName,
  parseFailureMarker,
  parseSnapshotMeta,
  type FailureMarker,
  type MaterializedSourceType,
} from "@/context/contextCacheStore";
import type { UrlItem } from "@/utils/urlTagUtils";
import type { TFile } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import type { App } from "obsidian";

export interface AgentProcessingSource {
  kind: MaterializedSourceType;
  source: string;
  fingerprint?: string;
}

export function buildAgentProcessingSources(
  urls: readonly UrlItem[],
  fileCandidates: readonly TFile[]
): AgentProcessingSource[] {
  return [
    ...urls.map((u): AgentProcessingSource => ({ kind: u.type, source: u.url })),
    ...fileCandidates.map(
      (f): AgentProcessingSource => ({
        kind: "file",
        source: f.path,
        fingerprint: `${f.stat.mtime}:${f.stat.size}`,
      })
    ),
  ];
}

export interface AgentCacheDirState {
  snapshotNames: Set<string>;
  markersByName: Map<string, FailureMarker>;
  fingerprintsByName: Map<string, string>;
}

export interface AgentCacheDirReader {
  list(): Promise<string[]>;
  readText(name: string): Promise<string>;
}

export async function aggregateAgentCacheDirState(
  readers: {
    remotes: AgentCacheDirReader;
    files: AgentCacheDirReader;
    markers: AgentCacheDirReader;
  },
  fileSnapshotNames: ReadonlySet<string>
): Promise<AgentCacheDirState> {
  const snapshotNames = new Set<string>();
  const markersByName = new Map<string, FailureMarker>();
  const fingerprintsByName = new Map<string, string>();

  const [remoteNames, fileNames, markerNames] = await Promise.all([
    listTolerant(readers.remotes),
    listTolerant(readers.files),
    listTolerant(readers.markers),
  ]);

  for (const name of remoteNames) {
    if (name.endsWith(".md")) snapshotNames.add(name);
  }
  for (const name of fileNames) {
    if (!name.endsWith(".md")) continue;
    snapshotNames.add(name);
    if (fileSnapshotNames.has(name)) {
      const meta = await readMetaTolerant(readers.files, name);
      if (meta) fingerprintsByName.set(name, meta.fingerprint);
    }
  }
  for (const name of markerNames) {
    if (!name.startsWith("failed-") || !name.endsWith(".json")) continue;
    const marker = await readJsonTolerant(readers.markers, name);
    if (marker) markersByName.set(name, marker);
  }

  return { snapshotNames, markersByName, fingerprintsByName };
}

export async function readAgentCacheDirState(
  app: App,
  projectId: string,
  fileSnapshotNames: ReadonlySet<string>
): Promise<AgentCacheDirState | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    const { remotesDir, filesDir, markersDir } = await import("@/context/conversionsLocation");
    const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
    const dirReader = (dir: string): AgentCacheDirReader => {
      const fs = createNodeContextCacheFs(dir);
      return { list: () => fs.list(""), readText: (name) => fs.readText(name) };
    };
    return await aggregateAgentCacheDirState(
      {
        remotes: dirReader(remotesDir(app)),
        files: dirReader(filesDir(app)),
        markers: dirReader(markersDir(app, projectId)),
      },
      fileSnapshotNames
    );
  } catch {
    return undefined;
  }
}

async function listTolerant(reader: AgentCacheDirReader): Promise<string[]> {
  try {
    return await reader.list();
  } catch {
    return [];
  }
}

async function readJsonTolerant(
  reader: AgentCacheDirReader,
  name: string
): Promise<FailureMarker | null> {
  try {
    return parseFailureMarker(await reader.readText(name));
  } catch {
    return null;
  }
}

async function readMetaTolerant(reader: AgentCacheDirReader, name: string) {
  try {
    return parseSnapshotMeta(await reader.readText(name));
  } catch {
    return null;
  }
}

function liveFailureMatches(failure: FailedItem, kind: MaterializedSourceType): boolean {
  if (kind === "file") return failure.type === "nonMd";
  return failure.type === kind;
}

const IN_FLIGHT_PHASES = new Set<AgentProjectContextLoadState["phase"]>([
  "resolve",
  "prefetch",
  "parse",
]);

export function buildAgentProcessingItems(
  sources: AgentProcessingSource[],
  liveEntry: AgentProjectContextLoadState | undefined,
  disk: AgentCacheDirState | undefined,
  savedKeys: ReadonlySet<string>
): ProcessingItem[] {
  const running = liveEntry !== undefined && IN_FLIGHT_PHASES.has(liveEntry.phase);
  const liveFailures = liveEntry?.failedSources ?? [];
  const retrying = liveEntry?.retryingSources ?? EMPTY_RETRYING_SOURCES;
  const processing = liveEntry?.processingSources ?? EMPTY_PROCESSING_SOURCES;

  return sources.map(({ kind, source, fingerprint }) => {
    const key = `${kind}:${source}`;
    let status: ProcessingItem["status"] = "pending";
    let error: string | undefined;

    const live = liveFailures.find((f) => f.path === source && liveFailureMatches(f, kind));
    const snapshotName = cacheFileName(kind, source);
    const hasSnapshot = disk?.snapshotNames.has(snapshotName) ?? false;
    const marker = disk?.markersByName.get(failureMarkerName(kind, source));
    const isRetrying = retrying.some((r) => r.kind === kind && r.source === source);
    const isProcessing = processing.some((p) => p.kind === kind && p.source === source);
    const stored = disk?.fingerprintsByName.get(snapshotName);
    const freshSnapshot =
      hasSnapshot && (kind !== "file" || (stored !== undefined && stored === fingerprint));
    const validMarker =
      marker !== undefined && (kind !== "file" || marker.fingerprint === fingerprint)
        ? marker
        : undefined;

    if ((isRetrying || isProcessing) && savedKeys.has(key)) {
      status = "processing";
    } else if (live && !live.usedStaleSnapshot) {
      status = "failed";
      error = live.error;
    } else if (live?.usedStaleSnapshot) {
      status = "ready";
    } else if (freshSnapshot) {
      status = "ready";
    } else if (validMarker) {
      status = "failed";
      error = validMarker.error;
    } else if (running && savedKeys.has(key)) {
      status = "pending";
    }

    return {
      ...processingItemEnvelope(kind, source),
      status,
      ...(error !== undefined ? { error } : {}),
    };
  });
}
