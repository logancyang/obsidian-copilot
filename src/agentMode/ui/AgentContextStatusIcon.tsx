import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import {
  agentProjectContextLoadAtom,
  type AgentProjectContextLoadState,
  type FailedItem,
  type ProjectConfig,
} from "@/aiParams";
import { AgentContextConversionModalContent } from "@/components/project/AgentContextConversionModalContent";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { useAgentPersistentFailureCount } from "@/components/project/useAgentPersistentFailureCount";
import { useAgentProcessingItems } from "@/components/project/useAgentProcessingItems";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { settingsStore } from "@/settings/model";
import { openAgentCachedItemPreview } from "@/utils/cacheFileOpener";
import { useAtomValue } from "jotai";
import { AlertCircle, CheckCircle, CircleDashed, Loader2 } from "lucide-react";
import { App } from "obsidian";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentContextStatusIconProps {
  app: App;
  activeProjectId: ProjectScopeId;
  project: ProjectConfig;
  hasConfiguredContextSource: boolean;
  landing: boolean;
  onReindex: () => boolean;
  onRetryItem: (item: ProcessingItem) => Promise<boolean>;
  onRefreshLanding: () => void | Promise<unknown>;
  onEditContext: () => void;
}

const WORKING_REVEAL_MS = 300;

type IconKind = "idle" | "working" | "ready" | "failed";

interface StatusView {
  kind: IconKind;
  headline: string;
  steps: StatusStep[];
  failures: FailedItem[];
}

interface StatusStep {
  label: string;
  status: "done" | "active" | "pending";
}

const PHASE_RANK: Record<AgentProjectContextLoadState["phase"], number> = {
  idle: -1,
  resolve: 0,
  prefetch: 1,
  parse: 2,
  done: 3,
};

function stepStatus(
  current: AgentProjectContextLoadState["phase"],
  stepPhase: "resolve" | "prefetch" | "parse",
  countComplete: boolean
): StatusStep["status"] {
  if (current === "done") return "done";
  if (countComplete) return "done";
  const rank = PHASE_RANK[current];
  const stepRank = PHASE_RANK[stepPhase];
  if (rank > stepRank) return "done";
  if (rank === stepRank) return "active";
  return "pending";
}

export function buildStatusView(
  entry: AgentProjectContextLoadState | undefined,
  hasConfiguredContextSource: boolean,
  persistentMissingCount = 0
): StatusView {
  const persistent = Math.max(0, persistentMissingCount);

  if (!entry || entry.phase === "idle") {
    if (persistent > 0) {
      return { kind: "failed", headline: failedHeadline(persistent), steps: [], failures: [] };
    }
    return { kind: "idle", headline: "No context loaded", steps: [], failures: [] };
  }

  const failures = entry.failedSources ?? [];
  const missing = failures.filter((f) => !f.usedStaleSnapshot);
  const done = entry.phase === "done";
  const inFlight =
    (entry.retryingSources?.length ?? 0) > 0 || (entry.processingSources?.length ?? 0) > 0;

  const steps: StatusStep[] = [];
  if (entry.resolved !== undefined && entry.resolved > 0) {
    steps.push({
      label: `Resolve files (${entry.resolved})`,
      status: stepStatus(entry.phase, "resolve", true),
    });
  }
  if (entry.prefetch) {
    const { done: d, total } = entry.prefetch;
    steps.push({
      label: `Prefetch ${total} ${total === 1 ? "URL" : "URLs"} · ${d}/${total}`,
      status: stepStatus(entry.phase, "prefetch", d >= total),
    });
  }
  if (entry.parsed) {
    const { done: d, total } = entry.parsed;
    steps.push({
      label: `Parse ${total} ${total === 1 ? "file" : "files"} · ${d}/${total}`,
      status: stepStatus(entry.phase, "parse", d >= total),
    });
  }

  if (!done || inFlight) {
    const totalCount = (entry.prefetch?.total ?? 0) + (entry.parsed?.total ?? 0);
    const doneCount = (entry.prefetch?.done ?? 0) + (entry.parsed?.done ?? 0);
    const headline =
      !done && totalCount > 0
        ? `Indexing context · ${doneCount}/${totalCount}`
        : "Indexing context";
    return { kind: "working", headline, steps, failures };
  }

  const missingCount = missing.length > 0 ? missing.length : persistent;
  if (missingCount > 0) {
    return { kind: "failed", headline: failedHeadline(missingCount), steps, failures };
  }
  if (!hasConfiguredContextSource && failures.length === 0) {
    return { kind: "idle", headline: "No context loaded", steps: [], failures: [] };
  }
  return { kind: "ready", headline: "Context ready", steps, failures };
}

function failedHeadline(count: number): string {
  return count === 1 ? "1 source failed" : `${count} sources failed`;
}

interface ResolvedStatus {
  view: StatusView;
  triggerKind: IconKind;
}

function useStatusView(
  app: App,
  activeProjectId: ProjectScopeId,
  project: ProjectConfig,
  hasConfiguredContextSource: boolean
): ResolvedStatus {
  const states = useAtomValue(agentProjectContextLoadAtom, { store: settingsStore });
  const entry = activeProjectId === GLOBAL_SCOPE ? undefined : states[activeProjectId];
  const persistentMissingCount = useAgentPersistentFailureCount(
    app,
    project,
    entry,
    activeProjectId !== GLOBAL_SCOPE && project.id === activeProjectId
  );
  const view = buildStatusView(entry, hasConfiguredContextSource, persistentMissingCount);

  const [revealWorking, setRevealWorking] = useState(false);
  const retryWhileDone =
    entry?.phase === "done" &&
    ((entry.retryingSources?.length ?? 0) > 0 || (entry.processingSources?.length ?? 0) > 0);
  const delayKey = `${activeProjectId}\0${entry?.phase ?? "none"}\0${retryWhileDone ? "retry" : ""}`;
  const prevKeyRef = useRef(delayKey);
  if (prevKeyRef.current !== delayKey) {
    prevKeyRef.current = delayKey;
    if (revealWorking) setRevealWorking(false);
  }

  useEffect(() => {
    if (view.kind !== "working") return;
    const timer = window.setTimeout(() => setRevealWorking(true), WORKING_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [view.kind, delayKey]);

  const masked = view.kind === "working" && !revealWorking && !retryWhileDone;
  return { view, triggerKind: masked ? "idle" : view.kind };
}

function TriggerIcon({ kind }: { kind: IconKind }) {
  if (kind === "failed") return <AlertCircle className="tw-size-4 tw-text-error" />;
  if (kind === "ready") return <CheckCircle className="tw-size-4 tw-text-success" />;
  if (kind === "idle") return <CircleDashed className="tw-size-4 tw-text-faint" />;
  return <Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />;
}

export default function AgentContextStatusIcon({
  app,
  activeProjectId,
  project,
  hasConfiguredContextSource,
  landing,
  onReindex,
  onRetryItem,
  onRefreshLanding,
  onEditContext,
}: AgentContextStatusIconProps) {
  const { triggerKind } = useStatusView(app, activeProjectId, project, hasConfiguredContextSource);
  const [open, setOpen] = useState(false);

  const openRef = useRef(open);
  const pendingRefreshScopeRef = useRef<ProjectScopeId | null>(null);
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);
  const onRefreshLandingRef = useRef(onRefreshLanding);
  useEffect(() => {
    onRefreshLandingRef.current = onRefreshLanding;
  }, [onRefreshLanding]);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const fireRefreshIfSameScope = useCallback((scope: ProjectScopeId) => {
    if (scope === activeProjectIdRef.current) void onRefreshLandingRef.current();
  }, []);

  const deferRefreshUntilClosed = useCallback(
    (scope: ProjectScopeId) => {
      if (openRef.current) pendingRefreshScopeRef.current = scope;
      else fireRefreshIfSameScope(scope);
    },
    [fireRefreshIfSameScope]
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      openRef.current = nextOpen;
      setOpen(nextOpen);
      if (!nextOpen && pendingRefreshScopeRef.current !== null) {
        const scope = pendingRefreshScopeRef.current;
        pendingRefreshScopeRef.current = null;
        fireRefreshIfSameScope(scope);
      }
    },
    [fireRefreshIfSameScope]
  );

  const handleRetryItem = useCallback(
    async (item: ProcessingItem) => {
      const scope = activeProjectIdRef.current;
      if ((await onRetryItem(item)) && mountedRef.current) deferRefreshUntilClosed(scope);
    },
    [onRetryItem, deferRefreshUntilClosed]
  );

  const handleRetryAll = useCallback(() => {
    const scope = activeProjectIdRef.current;
    if (onReindex()) deferRefreshUntilClosed(scope);
  }, [onReindex, deferRefreshUntilClosed]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          className="tw-text-muted"
          aria-label="Project context status"
        >
          <TriggerIcon kind={triggerKind} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side={landing ? "bottom" : "top"}
        className="tw-flex tw-max-h-[var(--radix-popover-content-available-height)] tw-w-[368px] tw-max-w-[calc(100vw-24px)] tw-flex-col tw-overflow-hidden tw-p-0"
      >
        {open && (
          <ConversionPopoverBody
            app={app}
            project={project}
            hasConfiguredContextSource={hasConfiguredContextSource}
            onRetryItem={safeAsyncHandler(handleRetryItem)}
            onRetryAll={handleRetryAll}
            onEditContext={() => {
              handleOpenChange(false);
              onEditContext();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ConversionPopoverBody({
  app,
  project,
  hasConfiguredContextSource,
  onRetryItem,
  onRetryAll,
  onEditContext,
}: {
  app: App;
  project: ProjectConfig;
  hasConfiguredContextSource: boolean;
  onRetryItem: (item: ProcessingItem) => void;
  onRetryAll: () => void;
  onEditContext: () => void;
}) {
  const { items, skippedMarkdownCount } = useAgentProcessingItems(
    app,
    project,
    project.contextSource
  );

  const handleOpenCachedItem = (item: ProcessingItem) => {
    void openAgentCachedItemPreview(app, item);
  };

  return (
    <AgentContextConversionModalContent
      items={items}
      hasConfiguredContextSource={hasConfiguredContextSource}
      skippedMarkdownCount={skippedMarkdownCount}
      onRetryItem={onRetryItem}
      onRetryAll={onRetryAll}
      onEditContext={onEditContext}
      onOpenCachedItem={handleOpenCachedItem}
    />
  );
}
