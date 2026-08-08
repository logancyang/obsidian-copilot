/**
 * Adapter that synthesizes the agent pipeline's three data sources — the live
 * `agentProjectContextLoadAtom` entry, the off-vault conversion-cache snapshots /
 * failure markers, and the (possibly unsaved) form draft — into the
 * ProcessingItem[] model rendered by the ProcessingStatus panel.
 *
 * Per-item status priority (highest first), mirroring the legacy CAG tracker's
 * `processing > failed > success > queued` set membership (with the agent's disk
 * snapshots/markers as the persistent success/failure truth between runs):
 *  1. source being (re-)fetched right now — per-row Retry OR the full run's live
 *     `processingSources` set → processing
 *  2. live failure settled THIS run (missing → failed; stale → ready)
 *  3. fresh disk snapshot present → Converted (for files, only when the stored
 *     `mtime:size` fingerprint still matches — a changed file falls through)
 *  4. valid disk failure marker → failed. Under Option D the next automatic run
 *     cheap-skips a known-bad source (no re-fetch until a manual Retry), so it
 *     reads as failed even mid-run, never "Queued". A file marker is honored only
 *     while its fingerprint still matches the live file (a changed file falls
 *     through to be re-attempted).
 *  5. a run is in flight and the source has no valid marker and hasn't
 *     started/settled yet → Queued (pending) — a genuinely new/changed source.
 *  6. otherwise → pending (Queued: the next materialization handles it)
 *
 * The live atom drives processing/failed; ready/queued otherwise come from disk.
 */

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

/** One configured source the agent pipeline would materialize. */
export interface AgentProcessingSource {
  kind: MaterializedSourceType;
  /** URL (web/youtube) or vault path (file). */
  source: string;
  /** Live `mtime:size` for files — stale-snapshot detection. Unset for URLs. */
  fingerprint?: string;
}

/**
 * Build the agent pipeline's configured-source list from already-resolved URL
 * items and file candidates: URL sources first (no fingerprint), then file
 * sources stamped with their live `mtime:size` fingerprint for stale-snapshot
 * detection. Callers pass their own candidate set (draft vs saved context) so
 * this stays a pure shape-builder — the single place the `AgentProcessingSource`
 * shape is constructed, shared by the processing-items and persistent-failure
 * read-models so the two can't drift.
 */
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

/** Read-only view of the agent's off-vault conversion cache, keyed by file name. */
export interface AgentCacheDirState {
  snapshotNames: Set<string>;
  markersByName: Map<string, FailureMarker>;
  /** Stored fingerprints of file-kind snapshots (only those we were asked to read). */
  fingerprintsByName: Map<string, string>;
}

/**
 * Minimal read surface over ONE off-vault cache directory (the reader is rooted
 * there, so names are basenames). Kept as an injectable interface so the pure
 * {@link aggregateAgentCacheDirState} is unit-testable with an in-memory fake —
 * the node:fs wiring lives only behind the desktop boundary in
 * {@link readAgentCacheDirState}.
 */
export interface AgentCacheDirReader {
  /** Entry basenames in the directory; resolves to `[]` when the dir is missing. */
  list(): Promise<string[]>;
  /** UTF-8 text of an entry by basename; rejects when missing/unreadable. */
  readText(name: string): Promise<string>;
}

/**
 * Aggregate the agent's cache status from its THREE off-vault sources: shared
 * remote snapshots (`remotes/`), shared file snapshots (`files/`), and this
 * project's failure markers (`markers/<projectHash>/`). Snapshots are shared
 * vault-wide (keyed by source identity), markers are per-project — so a status
 * read fans across both. Reads a snapshot's stored `mtime:size` only for the
 * file names in `fileSnapshotNames` (URL snapshots are identity-fingerprinted —
 * the name alone proves freshness, so their bodies are never read). Every
 * directory/file read is tolerant: a missing dir lists empty, an unreadable file
 * is skipped — a project that never materialized simply yields empty sets.
 *
 * Pure (fs injected) so it unit-tests without node:fs; the desktop wiring is in
 * {@link readAgentCacheDirState}.
 */
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

  // Remote snapshots: name alone proves freshness, so never read their bodies.
  for (const name of remoteNames) {
    if (name.endsWith(".md")) snapshotNames.add(name);
  }
  // File snapshots: read the stored fingerprint only for the requested names so a
  // changed file can be detected as stale.
  for (const name of fileNames) {
    if (!name.endsWith(".md")) continue;
    snapshotNames.add(name);
    if (fileSnapshotNames.has(name)) {
      const meta = await readMetaTolerant(readers.files, name);
      if (meta) fingerprintsByName.set(name, meta.fingerprint);
    }
  }
  // Per-project failure markers.
  for (const name of markerNames) {
    if (!name.startsWith("failed-") || !name.endsWith(".json")) continue;
    const marker = await readJsonTolerant(readers.markers, name);
    if (marker) markersByName.set(name, marker);
  }

  return { snapshotNames, markersByName, fingerprintsByName };
}

/**
 * Desktop-gated wiring of {@link aggregateAgentCacheDirState} over the off-vault
 * cache. Returns undefined on mobile or any failure — a project that never
 * materialized (or a non-desktop runtime with no Agent Mode) is not an error.
 *
 * MOBILE BOUNDARY (design §3.4, invariant 4): this module is statically imported
 * into the mobile bundle via the shared ContextManageModal, so it must NEVER
 * statically import `conversionsLocation` (top-level `node:os`/`node:path`) or
 * `contextCacheFs` (the node factory) — that would evaluate Node builtins at
 * bundle load and crash mobile. Both are loaded ONLY here, behind the desktop
 * gate, via dynamic import (esbuild splits them into a desktop-only chunk).
 */
export async function readAgentCacheDirState(
  app: App,
  projectId: string,
  fileSnapshotNames: ReadonlySet<string>
): Promise<AgentCacheDirState | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    const { remotesDir, filesDir, markersDir } = await import("@/context/conversionsLocation");
    const { createNodeContextCacheFs } = await import("@/context/contextCacheFs");
    // A root-confined fs rooted AT each directory, so listing is `list("")` and a
    // file read is `readText(name)` — no cache-root-relative path math, and the
    // directory layout stays owned solely by conversionsLocation.
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

/** Live FailedItem kinds map onto materialized-source kinds ("nonMd" ↔ "file"). */
function liveFailureMatches(failure: FailedItem, kind: MaterializedSourceType): boolean {
  if (kind === "file") return failure.type === "nonMd";
  return failure.type === kind;
}

const IN_FLIGHT_PHASES = new Set<AgentProjectContextLoadState["phase"]>([
  "resolve",
  "prefetch",
  "parse",
]);

/**
 * Build the panel's item list. `savedKeys` holds `${kind}:${source}` for every
 * source in the PERSISTED project config — a draft-only addition can't be
 * "processing" (no run knows about it yet), so it stays Queued until saved.
 */
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
    // A file snapshot is only trustworthy when its stored `mtime:size` still
    // matches the live file; a missing/unparseable fingerprint can't prove the
    // snapshot is current, so a changed file falls through to Queued/processing.
    // URL snapshots are identity-fingerprinted (the name alone proves freshness).
    const stored = disk?.fingerprintsByName.get(snapshotName);
    const freshSnapshot =
      hasSnapshot && (kind !== "file" || (stored !== undefined && stored === fingerprint));
    // A persisted failure the next automatic run will honor (Option D cheap-skips
    // a known-bad source until the user retries). Mirrors the materializer's skip
    // condition: a remote marker is identity-keyed; a file marker is trustworthy
    // only while its stored `mtime:size` still matches the live file — a changed
    // file (or a legacy marker with no fingerprint) is NOT valid, so it falls
    // through to be re-attempted rather than showing a stale failure.
    const validMarker =
      marker !== undefined && (kind !== "file" || marker.fingerprint === fingerprint)
        ? marker
        : undefined;

    if ((isRetrying || isProcessing) && savedKeys.has(key)) {
      // This source is being (re-)fetched right now — the per-row Retry, or the
      // full run's live processing set. Show the spinner.
      status = "processing";
    } else if (live && !live.usedStaleSnapshot) {
      status = "failed";
      error = live.error;
    } else if (live?.usedStaleSnapshot) {
      // A stale-but-usable live failure counts as converted (context is present).
      status = "ready";
    } else if (freshSnapshot) {
      status = "ready";
    } else if (validMarker) {
      // A known-bad source the next run will cheap-skip (Option D), so it reads as
      // failed even mid-run — NOT "Queued", which would wrongly imply it's about
      // to be processed when nothing will re-fetch it until a manual Retry.
      status = "failed";
      error = validMarker.error;
    } else if (running && savedKeys.has(key)) {
      // A run is active and this source has no valid failure marker and hasn't
      // started/settled yet → Queued (a genuinely new/changed source the run will
      // attempt).
      //
      // DESIGN NOTE — success is disk-truth, NOT a live atom set. When a source
      // emits `itemSettled` it leaves `processingSources`, but its fresh snapshot
      // isn't observed until `useAgentProcessingItems` re-reads the cache dir (it
      // re-reads on every `liveEntry` change). So a just-settled source can read
      // as Queued here for one async cache-dir read (~tens of ms) before flipping
      // to Ready — a transient, self-correcting popover flicker. We deliberately
      // do NOT keep a 4th live `succeededSources` set to erase it: that would
      // duplicate the whole processingSources machinery (atom field + publish +
      // clear + tests) to smooth a cosmetic blip that never touches the cache,
      // the send gate, or captured session context.
      status = "pending";
    }

    return {
      // Envelope (id/name/source/fileType) is shared with the CAG adapter so the
      // two produce structurally identical items; `id` is the raw URL / vault
      // path, which the shared ProcessingStatus row renders for URLs and the
      // modal's remove handler matches by (cacheKind, id).
      ...processingItemEnvelope(kind, source),
      status,
      ...(error !== undefined ? { error } : {}),
    };
  });
}
