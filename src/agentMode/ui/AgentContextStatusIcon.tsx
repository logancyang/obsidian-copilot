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

interface AgentContextStatusIconProps {
  app: App;
  /** Active workspace scope. {@link GLOBAL_SCOPE} never has a per-project entry. */
  activeProjectId: ProjectScopeId;
  /** The active project — drives the conversion popover's per-source list/preview. */
  project: ProjectConfig;
  /**
   * Whether the project declares any context source (folder/note/tag/ext/URL/
   * file). When false, a completed run with no failures rests on the neutral
   * `idle` icon (nothing to report) rather than the green "ready" check. Computed
   * by the parent from the project config.
   */
  hasConfiguredContextSource: boolean;
  /**
   * Whether the composer is in its landing layout (vertically centered, with
   * content below it) rather than docked at the pane bottom. Drives the popover
   * open direction: down from a centered composer (room below, would otherwise
   * cover the hero above), up from a docked one. Radix still flips on collision
   * if the chosen side lacks room.
   */
  landing: boolean;
  /** Whole-run re-materialize (popover "Retry all/failed"): re-attempts failed
   * sources (already-successful snapshots cheap-skip by fingerprint). Returns
   * whether a run actually started (false for no-op scopes). */
  onReindex: () => boolean;
  /** Per-source retry (popover row "Retry") → `AgentSessionManager.rematerializeSource`.
   * Resolves to whether the retry actually ran (false when deduped/skipped). */
  onRetryItem: (item: ProcessingItem) => Promise<boolean>;
  /** Re-capture context into an empty landing session. Deferred until the popover
   * closes so a retry's completion can't yank the popover out from under the user
   * (the session swap remounts the composer, see {@link handleOpenChange}). The
   * return value (if any) is not awaited — callers fire-and-forget. */
  onRefreshLanding: () => void | Promise<unknown>;
  /** Open the project's context editor (popover "Edit context"). */
  onEditContext: () => void;
}

/** Delay before the working spinner appears, so a warm (cache-hit) run that
 * settles within the window keeps resting on the neutral `idle` icon instead of
 * flashing the spinner (anti-flash). */
const WORKING_REVEAL_MS = 300;

/**
 * The composer icon's resting/active glyphs — mirrors the legacy CAG chat-input
 * status icon (`ChatContextMenu`): `idle` is its gray `CircleDashed`, the other
 * three its spinner/check/alert. There is no "hidden": the icon is always shown
 * for a project scope, resting on `idle` when there's nothing to report.
 */
type IconKind = "idle" | "working" | "ready" | "failed";

interface StatusView {
  kind: IconKind;
  /** Collapsed headline shown in the popover header. */
  headline: string;
  /** Step rows (resolve/prefetch/parse), real counts only — never fabricated. */
  steps: StatusStep[];
  /** Per-source failures (already mapped to FailedItem by the manager). */
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

/**
 * Derive the icon's view model from the raw load entry. Pure (no atom/timer), so
 * it is unit-testable in isolation.
 *
 * - `idle`: no entry, idle phase, or a clean completion for a project that
 *   declares no context source (nothing worth reporting — the neutral resting
 *   state, mirroring the legacy CAG icon's `initial`).
 * - `failed`: completed with at least one MISSING source (`usedStaleSnapshot`
 *   false). Stale-but-usable failures alone stay `ready` (green) — context is
 *   present, just old; the popover flags the staleness.
 * - `ready`: completed, no missing sources, project has context configured.
 * - `working`: a materialization phase is in flight.
 */
export function buildStatusView(
  entry: AgentProjectContextLoadState | undefined,
  hasConfiguredContextSource: boolean,
  persistentMissingCount = 0
): StatusView {
  // Failures persist as on-disk markers (Option D), so a settled project can have
  // failed sources the live atom no longer carries. `persistentMissingCount` (a
  // disk read by the always-mounted icon — see useAgentPersistentFailureCount)
  // surfaces them as failed even when no run is driving the atom. Only a NON-zero
  // count matters; it never overrides an in-flight `working`.
  const persistent = Math.max(0, persistentMissingCount);

  if (!entry || entry.phase === "idle") {
    // `persistent` is fed only here-via-`!entry`: a project that never ran a
    // materialization this session (e.g. a reused landing) has NO atom entry, yet
    // its prior failures live on disk. The `phase === "idle"` arm never receives a
    // non-zero `persistent` because the hook gates its disk read to settled-done /
    // no-entry (no producer writes a per-project `phase: "idle"` entry today); it
    // shares this arm only to fall through to the same neutral idle glyph. The
    // idle/persistent pairing is intentional — the live path is the `!entry` one.
    if (persistent > 0) {
      return { kind: "failed", headline: failedHeadline(persistent), steps: [], failures: [] };
    }
    return { kind: "idle", headline: "No context loaded", steps: [], failures: [] };
  }

  const failures = entry.failedSources ?? [];
  const missing = failures.filter((f) => !f.usedStaleSnapshot);
  const done = entry.phase === "done";
  // A per-source / per-row retry runs while the phase stays `done` (it only sets
  // `retryingSources`), and a full run carries `processingSources` mid-flight.
  // Either means work is in flight, so the glyph must read "working" — not the
  // green "ready" the bare phase check would give after an optimistic retry
  // clears the failure.
  const inFlight =
    (entry.retryingSources?.length ?? 0) > 0 || (entry.processingSources?.length ?? 0) > 0;

  // Build the real-count step rows — never fabricated, so a row appears only for
  // work that actually has a count (resolved files, prefetched URLs, parsed files).
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

  // Completed.
  // Live missing failures take precedence; otherwise fall back to the persisted
  // on-disk markers (the settled-state truth the popover already shows).
  const missingCount = missing.length > 0 ? missing.length : persistent;
  if (missingCount > 0) {
    return { kind: "failed", headline: failedHeadline(missingCount), steps, failures };
  }
  // Clean (or stale-only) completion. Rest on the neutral `idle` icon when the
  // project has no configured context source — there is nothing to call "ready".
  if (!hasConfiguredContextSource && failures.length === 0) {
    return { kind: "idle", headline: "No context loaded", steps: [], failures: [] };
  }
  return { kind: "ready", headline: "Context ready", steps, failures };
}

/** "N source(s) failed" headline for the failed glyph. */
function failedHeadline(count: number): string {
  return count === 1 ? "1 source failed" : `${count} sources failed`;
}

interface ResolvedStatus {
  /** The real status — drives the popover's headline, steps, failures, actions. */
  view: StatusView;
  /**
   * The glyph the trigger button shows. Equals `view.kind` except during the
   * anti-flash window, where a `working` run is masked as `idle` so a warm run
   * doesn't flash the spinner. The popover still reflects the real `view`, so
   * opening it mid-mask shows the true "indexing" state (never a false Retry).
   */
  triggerKind: IconKind;
}

/**
 * Reads the projectId-keyed load atom and applies the anti-flash delay: while a
 * run is `working`, the TRIGGER GLYPH stays on the neutral `idle` icon until
 * {@link WORKING_REVEAL_MS} has elapsed. A warm run that completes within the
 * window therefore never flashes the spinner — the glyph goes straight from
 * `idle` to `ready`/`failed`. Terminal states render immediately. Reset per
 * project so a peer's timer never leaks in. The masking is glyph-only: `view`
 * always carries the real status for the popover.
 */
function useStatusView(
  app: App,
  activeProjectId: ProjectScopeId,
  project: ProjectConfig,
  hasConfiguredContextSource: boolean
): ResolvedStatus {
  const states = useAtomValue(agentProjectContextLoadAtom, { store: settingsStore });
  const entry = activeProjectId === GLOBAL_SCOPE ? undefined : states[activeProjectId];
  // Persisted on-disk failures the live atom may not carry once a run has settled
  // (Option D). Only consulted for the active project; gated to settled states
  // inside the hook so a live run pays no extra disk I/O.
  const persistentMissingCount = useAgentPersistentFailureCount(
    app,
    project,
    entry,
    activeProjectId !== GLOBAL_SCOPE && project.id === activeProjectId
  );
  const view = buildStatusView(entry, hasConfiguredContextSource, persistentMissingCount);

  // Anti-flash gate, keyed on project + phase + a retry-episode flag so a fresh
  // working phase restarts the delay and a project switch resets it. The flag
  // captures ONLY a retry that runs while the phase stays `done` (the one working
  // episode the phase can't mark); a live run's per-item `processingSources`
  // churn must NOT enter the key, or the spinner would re-mask to idle at every
  // source boundary. The reset is done during render (React's "adjust state from
  // props" pattern) so only the timer's async reveal touches state from the
  // effect — keeping the effect side-effect-only.
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

  // Anti-flash masks a `working` glyph as `idle` for the first WORKING_REVEAL_MS
  // so a warm AUTO run that settles fast never flashes the spinner. A
  // user-initiated retry (the `retryWhileDone` working episode) is exempt: the
  // user just clicked, so show the spinner immediately rather than blink the
  // neutral "no context" glyph first.
  const masked = view.kind === "working" && !revealWorking && !retryWhileDone;
  return { view, triggerKind: masked ? "idle" : view.kind };
}

/** Leading trigger icon for the current kind — mirrors the legacy CAG project
 * status icon (CircleDashed / Loader2 / CheckCircle / AlertCircle, same size +
 * theme colors). `idle` is the gray resting glyph. */
function TriggerIcon({ kind }: { kind: IconKind }) {
  if (kind === "failed") return <AlertCircle className="tw-size-4 tw-text-error" />;
  if (kind === "ready") return <CheckCircle className="tw-size-4 tw-text-success" />;
  if (kind === "idle") return <CircleDashed className="tw-size-4 tw-text-faint" />;
  return <Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />;
}

/**
 * Composer status icon for a project's context materialization. Sits in the
 * composer's top row (right of the context badges). The trigger glyph reflects
 * idle/working/ready/failed (with an anti-flash delay); clicking opens the
 * unified Content Conversion popover (design S) — the SAME surface the project
 * header opens, so there's one place to see per-source status, retry a single
 * source / the whole run, and jump to Edit context. Only mounted for a real
 * (non-global, non-orphaned) project by the parent.
 */
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

  // A retry/reindex re-captures context by swapping the empty landing session,
  // which remounts this whole composer subtree (ChatInput is `key={sessionId}`)
  // and would close the popover. So we hold that refresh until the popover is
  // dismissed. `openRef` lets a retry settling AFTER an early close still fire it.
  const openRef = useRef(open);
  // The scope a deferred refresh belongs to, captured when the retry/reindex was
  // triggered (null = none pending). A retry can settle after the user switched
  // projects on this same — never-remounted — composer icon; firing the landing
  // refresh then would re-materialize the NEW project's session. So we only fire
  // when the captured scope still matches the active one.
  const pendingRefreshScopeRef = useRef<ProjectScopeId | null>(null);
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);
  // Always call the LATEST refresh. A slow retry can settle after the user closed
  // the popover and started typing; the click-time closure would still see the
  // old (empty) draft and wrongly replace the session, wiping that input. The
  // current-render callback closes over the current draft, so its own empty-draft
  // guard no-ops correctly.
  const onRefreshLandingRef = useRef(onRefreshLanding);
  useEffect(() => {
    onRefreshLandingRef.current = onRefreshLanding;
  }, [onRefreshLanding]);

  // A per-source retry can settle after the user has switched scope and this icon
  // unmounted; don't fire the landing refresh from a dead instance (it would act
  // on whatever session is active by then).
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  // Fire the landing refresh only if the still-active scope matches the one the
  // refresh was queued for (see {@link pendingRefreshScopeRef}).
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
      {/* 368px + p-0: the conversion content owns its own width/padding and a
          single inner scroll layer (no nested popover scroll). Open direction
          follows the composer: down on the landing (centered), up when docked. */}
      <PopoverContent
        align="end"
        side={landing ? "bottom" : "top"}
        className="tw-flex tw-max-h-[var(--radix-popover-content-available-height)] tw-w-[368px] tw-max-w-[calc(100vw-24px)] tw-flex-col tw-overflow-hidden tw-p-0"
      >
        {/* Mounted only while open, so the per-source read-model (disk + atom)
            runs on demand rather than for every composer render. */}
        {open && (
          <ConversionPopoverBody
            app={app}
            project={project}
            hasConfiguredContextSource={hasConfiguredContextSource}
            onRetryItem={handleRetryItem}
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

/**
 * The popover's body: reads the per-source conversion model and renders the
 * shared three-state {@link AgentContextConversionModalContent}. Split out so
 * `useAgentProcessingItems` only runs while the popover is open.
 */
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
    // Off-vault snapshots are keyed by source identity, so no project folder is
    // needed — the item's kind + id locate the snapshot.
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
