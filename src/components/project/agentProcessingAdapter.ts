import type { AgentProjectContextLoadState } from "@/aiParams";
import { EMPTY_PROCESSING_SOURCES, EMPTY_RETRYING_SOURCES } from "@/aiParams";
import {
  processingItemEnvelope,
  type ProcessingItem,
} from "@/components/project/processingAdapter";
import {
  cacheFileName,
  failureMarkerName,
  parseFailureMarker,
  PROJECT_CONTEXT_FAILURE_SOURCE,
  type FailureMarker,
  type MaterializedSourceType,
} from "@/context/contextCacheStore";
import type { UrlItem } from "@/utils/urlTagUtils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import type { App } from "obsidian";

export interface AgentProcessingSource {
  kind: MaterializedSourceType;
  source: string;
}

export function buildAgentProcessingSources(urls: readonly UrlItem[]): AgentProcessingSource[] {
  return urls.map((u): AgentProcessingSource => ({ kind: u.type, source: u.url }));
}

export interface AgentCacheDirState {
  snapshotNames: Set<string>;
  markersByName: Map<string, FailureMarker>;
}

export interface AgentCacheDirReader {
  list(): Promise<string[]>;
  readText(name: string): Promise<string>;
}

export async function aggregateAgentCacheDirState(readers: {
  remotes: AgentCacheDirReader;
  markers: AgentCacheDirReader;
}): Promise<AgentCacheDirState> {
  const snapshotNames = new Set<string>();
  const markersByName = new Map<string, FailureMarker>();

  const [remoteNames, markerNames] = await Promise.all([
    listTolerant(readers.remotes),
    listTolerant(readers.markers),
  ]);

  for (const name of remoteNames) {
    if (name.endsWith(".md")) snapshotNames.add(name);
  }
  for (const name of markerNames) {
    if (!name.startsWith("failed-") || !name.endsWith(".json")) continue;
    const marker = await readJsonTolerant(readers.markers, name);
    if (marker) markersByName.set(name, marker);
  }

  return { snapshotNames, markersByName };
}

export async function readAgentCacheDirState(
  app: App,
  projectId: string
): Promise<AgentCacheDirState | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    const { remotesDir, markersDir } = await import("@/context/conversionsLocation");
    const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
    const dirReader = (dir: string): AgentCacheDirReader => {
      const fs = createNodeContextCacheFs(dir);
      return { list: () => fs.list(""), readText: (name) => fs.readText(name) };
    };
    return await aggregateAgentCacheDirState({
      remotes: dirReader(remotesDir(app)),
      markers: dirReader(markersDir(app, projectId)),
    });
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

// A whole-context failure names no configured source, so it needs its own state or the popover reads as healthy. https://github.com/Brevilabs/obsidian-copilot-private/issues/657
export function findProjectContextFailure(
  liveEntry: AgentProjectContextLoadState | undefined
): string | undefined {
  return liveEntry?.failedSources?.find((f) => f.path === PROJECT_CONTEXT_FAILURE_SOURCE)?.error;
}

const IN_FLIGHT_PHASES = new Set<AgentProjectContextLoadState["phase"]>(["resolve", "prefetch"]);

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

  return sources.map(({ kind, source }) => {
    const key = `${kind}:${source}`;
    let status: ProcessingItem["status"] = "pending";
    let error: string | undefined;

    const live = liveFailures.find((f) => f.path === source && f.type === kind);
    const snapshotName = cacheFileName(kind, source);
    const hasSnapshot = disk?.snapshotNames.has(snapshotName) ?? false;
    const marker = disk?.markersByName.get(failureMarkerName(kind, source));
    const isRetrying = retrying.some((r) => r.kind === kind && r.source === source);
    const isProcessing = processing.some((p) => p.kind === kind && p.source === source);

    if ((isRetrying || isProcessing) && savedKeys.has(key)) {
      status = "processing";
    } else if (live && !live.usedStaleSnapshot) {
      status = "failed";
      error = live.error;
    } else if (live?.usedStaleSnapshot) {
      status = "ready";
    } else if (hasSnapshot) {
      status = "ready";
    } else if (marker) {
      status = "failed";
      error = marker.error;
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
