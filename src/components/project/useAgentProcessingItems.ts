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
  skippedMarkdownCount: number;
}

const EMPTY_PROCESSING_ITEMS: ProcessingItem[] = Object.freeze([]) as unknown as ProcessingItem[];

export function useAgentProcessingItems(
  app: App,
  project: ProjectConfig,
  contextSource: ProjectConfig["contextSource"],
  options?: { enabled?: boolean }
): AgentProcessingItemsState {
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
