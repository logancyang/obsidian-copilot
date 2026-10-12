import { type AgentProjectContextLoadState, type ProjectConfig } from "@/aiParams";
import {
  buildAgentProcessingItems,
  buildAgentProcessingSources,
  readAgentCacheDirState,
  type AgentProcessingSource,
} from "@/components/project/agentProcessingAdapter";
import { parseProjectUrls } from "@/utils/urlTagUtils";
import type { App } from "obsidian";
import { useEffect, useMemo, useState } from "react";

export function useAgentPersistentFailureCount(
  app: App,
  project: ProjectConfig,
  liveEntry: AgentProjectContextLoadState | undefined,
  enabled: boolean
): number {
  const settled =
    enabled &&
    (liveEntry === undefined || liveEntry.phase === "done") &&
    (liveEntry?.retryingSources?.length ?? 0) === 0 &&
    (liveEntry?.processingSources?.length ?? 0) === 0;

  const sources = useMemo<AgentProcessingSource[]>(() => {
    if (!settled) return EMPTY_SOURCES;
    const contextSource = project.contextSource;
    const urls = parseProjectUrls(contextSource?.webUrls || "", contextSource?.youtubeUrls || "");
    return buildAgentProcessingSources(urls);
  }, [project.contextSource, settled]);

  const savedKeys = useMemo<ReadonlySet<string>>(
    () =>
      sources.length === 0 ? EMPTY_KEYS : new Set(sources.map((s) => `${s.kind}:${s.source}`)),
    [sources]
  );
  const sourceKey = useMemo(
    () => sources.map((s) => `${s.kind}:${s.source}`).join("\n"),
    [sources]
  );

  const [result, setResult] = useState<FailureCountResult | undefined>(undefined);

  useEffect(() => {
    if (!settled || sources.length === 0) return;
    let cancelled = false;
    void readAgentCacheDirState(app, project.id).then((disk) => {
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
  }, [app, project.id, sources, savedKeys, sourceKey, liveEntry, settled]);

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

const EMPTY_SOURCES = Object.freeze([] as AgentProcessingSource[]) as AgentProcessingSource[];
const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();
