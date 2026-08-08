import { agentProjectContextLoadAtom, type ProjectConfig } from "@/aiParams";
import {
  buildAgentProcessingItems,
  buildAgentProcessingSources,
  readAgentCacheDirState,
  type AgentCacheDirState,
  type AgentProcessingSource,
} from "@/components/project/agentProcessingAdapter";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { cacheFileName } from "@/context/contextCacheStore";
import {
  listMaterializeCandidates,
  listMaterializeContextFileSummary,
} from "@/context/materializeCandidates";
import { settingsStore } from "@/settings/model";
import { parseProjectUrls } from "@/utils/urlTagUtils";
import { useAtomValue } from "jotai";
import type { App } from "obsidian";
import { useEffect, useMemo, useState } from "react";

export interface AgentProcessingItemsState {
  items: ProcessingItem[];
  /** Matched `.md` files (no conversion needed) — for the "N skipped" note. */
  skippedMarkdownCount: number;
}

// Referentially stable empty so a disabled call never feeds callers a fresh [].
const EMPTY_PROCESSING_ITEMS: ProcessingItem[] = Object.freeze([]) as unknown as ProcessingItem[];

/**
 * The agent pipeline's Content Conversion read-model: synthesizes the live load
 * atom + the off-vault conversion cache + the (possibly draft) context source into the
 * ProcessingItem[] the status UI renders, plus the skipped-markdown count.
 *
 * Extracted from AgentProcessingStatusPanel so the Edit-modal panel and the
 * standalone conversion modal share ONE data path. Reactive: a retry that
 * updates the load atom (or rewrites a snapshot) re-renders both surfaces.
 *
 * `contextSource` is passed separately from `project` so the Edit modal can feed
 * its unsaved DRAFT (newly added sources show as Queued); `project.contextSource`
 * is the saved set used to decide which sources a run can actually see.
 */
export function useAgentProcessingItems(
  app: App,
  project: ProjectConfig,
  contextSource: ProjectConfig["contextSource"],
  options?: { enabled?: boolean }
): AgentProcessingItemsState {
  // Disabled for CAG callers: the agent read-model enumerates context sources and
  // reads the off-vault cache (node fs, desktop-only), which a CAG/chat project
  // has no use for. A caller that always mounts this hook (React rule) passes
  // `enabled: false` to short-circuit it to a stable empty result, skipping that
  // work. (The atom is still subscribed — hooks run unconditionally — but its
  // value is unused when disabled, so it only costs a harmless re-render.)
  const enabled = options?.enabled ?? true;
  const loadStates = useAtomValue(agentProjectContextLoadAtom, { store: settingsStore });
  const liveEntry = enabled ? loadStates[project.id] : undefined;

  const inclusions = enabled ? contextSource?.inclusions : undefined;
  const exclusions = enabled ? contextSource?.exclusions : undefined;
  const summary = useMemo(
    () =>
      enabled
        ? listMaterializeContextFileSummary(app, { inclusions, exclusions })
        : { candidates: [], skippedMarkdownCount: 0 },
    [app, enabled, inclusions, exclusions]
  );
  const candidates = summary.candidates;

  const sources = useMemo<AgentProcessingSource[]>(() => {
    if (!enabled) return [];
    const urls = parseProjectUrls(contextSource?.webUrls || "", contextSource?.youtubeUrls || "");
    return buildAgentProcessingSources(urls, candidates);
  }, [enabled, contextSource?.webUrls, contextSource?.youtubeUrls, candidates]);

  // Sources a materialization run can actually see — i.e. the persisted config.
  // Draft-only additions are excluded so they can't show as "processing".
  const savedContextSource = project.contextSource;
  const savedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!enabled) return keys;
    const urls = parseProjectUrls(
      savedContextSource?.webUrls || "",
      savedContextSource?.youtubeUrls || ""
    );
    for (const u of urls) keys.add(u.id);
    for (const f of listMaterializeCandidates(app, savedContextSource)) keys.add(`file:${f.path}`);
    return keys;
  }, [app, enabled, savedContextSource]);

  const fileSnapshotNames = useMemo(
    () => new Set(candidates.map((f) => cacheFileName("file", f.path))),
    [candidates]
  );

  const [disk, setDisk] = useState<AgentCacheDirState | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setDisk(undefined);
      return;
    }
    // Re-read the off-vault cache whenever the live atom entry changes — not just
    // on `phase`. A single-source retry rewrites snapshots / deletes a failure
    // marker while leaving phase at "done", so keying on the whole entry is what
    // lets the panel drop a now-fixed failure. The cancelled flag drops a stale read.
    let cancelled = false;
    void readAgentCacheDirState(app, project.id, fileSnapshotNames).then((state) => {
      if (!cancelled) setDisk(state);
    });
    return () => {
      cancelled = true;
    };
  }, [app, enabled, project.id, fileSnapshotNames, liveEntry]);

  const items = useMemo(
    () =>
      enabled
        ? buildAgentProcessingItems(sources, liveEntry, disk, savedKeys)
        : EMPTY_PROCESSING_ITEMS,
    [enabled, sources, liveEntry, disk, savedKeys]
  );

  return { items, skippedMarkdownCount: summary.skippedMarkdownCount };
}
