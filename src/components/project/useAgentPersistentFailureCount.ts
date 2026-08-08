import { type AgentProjectContextLoadState, type ProjectConfig } from "@/aiParams";
import {
  buildAgentProcessingItems,
  buildAgentProcessingSources,
  readAgentCacheDirState,
  type AgentProcessingSource,
} from "@/components/project/agentProcessingAdapter";
import { cacheFileName } from "@/context/contextCacheStore";
import { listMaterializeCandidates } from "@/context/materializeCandidates";
import { parseProjectUrls } from "@/utils/urlTagUtils";
import type { App } from "obsidian";
import { useEffect, useMemo, useState } from "react";

/**
 * Lightweight persistent-failure read-model for the ALWAYS-MOUNTED context
 * status icon. The popover's per-source list reads disk markers via
 * {@link useAgentProcessingItems}, but that hook only runs while the popover is
 * open — so the resting icon would otherwise rely solely on the live atom and
 * show green "ready" for a project whose failures live only as on-disk markers
 * (Option D: a failed source persists a marker and is cheap-skipped until a
 * manual retry, so no live run repopulates `failedSources`).
 *
 * This hook closes that gap with the minimum work:
 *  - It reads the cache dir ONLY when materialization is settled (no run in
 *    flight). During a run the live atom is authoritative — the icon already
 *    derives failed/working from it — so we never add disk I/O on a per-progress
 *    tick to an always-mounted component.
 *  - It asks `readAgentCacheDirState` to read snapshot meta for the configured
 *    FILE sources (not just markers). Remote snapshots prove freshness by name
 *    alone, but file snapshots need their stored `mtime:size` fingerprint:
 *    snapshots are now SHARED across projects, so a fresh snapshot written by
 *    another project must be able to override THIS project's stale-but-still-
 *    fingerprint-matching failure marker — otherwise the resting icon keeps
 *    flagging a failure another project already resolved.
 *  - It reuses `buildAgentProcessingItems`' marker rules rather than reimplement
 *    them, so the icon and the popover never diverge on what counts as failed.
 */
export function useAgentPersistentFailureCount(
  app: App,
  project: ProjectConfig,
  liveEntry: AgentProjectContextLoadState | undefined,
  enabled: boolean
): number {
  // Settled = no run is driving the atom: either no entry, or a completed phase
  // with nothing retrying/processing. Only then is the disk the authoritative
  // failure source the icon must consult.
  const settled =
    enabled &&
    (liveEntry === undefined || liveEntry.phase === "done") &&
    (liveEntry?.retryingSources?.length ?? 0) === 0 &&
    (liveEntry?.processingSources?.length ?? 0) === 0;

  const sources = useMemo<AgentProcessingSource[]>(() => {
    if (!settled) return EMPTY_SOURCES;
    const contextSource = project.contextSource;
    const urls = parseProjectUrls(contextSource?.webUrls || "", contextSource?.youtubeUrls || "");
    return buildAgentProcessingSources(urls, listMaterializeCandidates(app, contextSource));
  }, [app, project.contextSource, settled]);

  // Snapshot names of the FILE sources, so the read fetches their stored
  // fingerprints (a shared fresh snapshot can then override this project's stale
  // marker). Remotes are omitted — their name alone proves freshness, so reading
  // their bodies would be wasted I/O on an always-mounted component.
  const fileSnapshotNames = useMemo<ReadonlySet<string>>(() => {
    let names: Set<string> | undefined;
    for (const source of sources) {
      if (source.kind !== "file") continue;
      (names ??= new Set<string>()).add(cacheFileName("file", source.source));
    }
    return names ?? EMPTY_FILE_SNAPSHOT_NAMES;
  }, [sources]);

  const savedKeys = useMemo<ReadonlySet<string>>(
    () =>
      sources.length === 0 ? EMPTY_KEYS : new Set(sources.map((s) => `${s.kind}:${s.source}`)),
    [sources]
  );
  // A content signature of the source set, so a project/source switch invalidates
  // a previously-read count (which belonged to a different project).
  const sourceKey = useMemo(
    () => sources.map((s) => `${s.kind}:${s.source}:${s.fingerprint ?? ""}`).join("\n"),
    [sources]
  );

  const [result, setResult] = useState<FailureCountResult | undefined>(undefined);

  useEffect(() => {
    if (!settled || sources.length === 0) return;
    let cancelled = false;
    void readAgentCacheDirState(app, project.id, fileSnapshotNames).then((disk) => {
      if (cancelled) return;
      const count = disk
        ? buildAgentProcessingItems(sources, undefined, disk, savedKeys).filter(
            (item) => item.status === "failed"
          ).length
        : 0;
      setResult({ projectId: project.id, sourceKey, liveEntry, count });
    });
    return () => {
      cancelled = true;
    };
  }, [app, project.id, sources, savedKeys, sourceKey, liveEntry, settled, fileSnapshotNames]);

  // Return the cached count only when it was computed for the CURRENT project,
  // source set, and live entry — otherwise 0 (a project/source/entry change
  // invalidates it until the next read lands, mirroring the popover's disk lag).
  const fresh =
    settled &&
    sources.length > 0 &&
    result?.projectId === project.id &&
    result.sourceKey === sourceKey &&
    result.liveEntry === liveEntry;
  return fresh ? result.count : 0;
}

interface FailureCountResult {
  projectId: string;
  sourceKey: string;
  liveEntry: AgentProjectContextLoadState | undefined;
  count: number;
}

// Referential stability: frozen/shared empties so a "no sources" render never
// allocates a fresh collection (keeps the memo deps stable).
const EMPTY_SOURCES = Object.freeze([] as AgentProcessingSource[]) as AgentProcessingSource[];
const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();
const EMPTY_FILE_SNAPSHOT_NAMES: ReadonlySet<string> = new Set<string>();
