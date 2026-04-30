import { Button } from "@/components/ui/button";
import { logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import {
  planBodyToMarkdown,
  type CurrentPlan,
  type PlanDecisionAction,
} from "@/agentMode/session/types";
import { Check, FileText, X as XIcon } from "lucide-react";
import { App, Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

export const PLAN_PREVIEW_VIEW_TYPE = "copilot-plan-preview-view";

/**
 * State the chat card hands to the preview view via `setViewState`. The
 * markdown body is the seed; once mounted the view subscribes to
 * `chatBackend.getCurrentPlan()` so subsequent revisions
 * (Claude editing the plan file, OpenCode emitting a new structured plan)
 * swap the rendered markdown in place. When `currentPlan` becomes `null`
 * the view shows an empty "Plan no longer pending" state instead of a
 * stale snapshot.
 */
export interface PlanPreviewViewState {
  proposalId: string;
  planMarkdown: string;
  // Used as the displayed title.
  title?: string;
  // Lets the view subscribe for live updates of the singleton plan.
  chatBackend?: AgentChatBackend;
}

/**
 * Read-only main-area tab that renders the singleton plan proposal as
 * fully-rendered markdown (via Obsidian's `MarkdownRenderer`). Mirrors
 * the registration pattern used by `ApplyView` (see
 * `src/components/composer/ApplyView.tsx`).
 *
 * No vault file is created — the markdown lives only in the agent message
 * store; closing the tab discards the rendered DOM but the chat card keeps
 * the source. The container is a plain `<div>` (no editor instance), so the
 * content is read-only by construction.
 */
export class PlanPreviewView extends ItemView {
  private root: Root | null = null;
  private state: PlanPreviewViewState | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return PLAN_PREVIEW_VIEW_TYPE;
  }

  getIcon(): string {
    return "clipboard-list";
  }

  getDisplayText(): string {
    return this.state?.title?.trim() || "Plan proposal";
  }

  /** Public accessor used by `openPlanPreview` to identify reusable tabs. */
  getProposalId(): string | undefined {
    return this.state?.proposalId;
  }

  async setState(state: PlanPreviewViewState): Promise<void> {
    // Obsidian's view lifecycle (and workspace restore on plugin reload)
    // can invoke setState with an empty object. We don't restore plan
    // tabs from disk — see getState() — so ignore those calls instead of
    // overwriting valid state with a blank one.
    if (!state || !state.planMarkdown) return;
    this.state = state;
    this.render();
  }

  // Workspaces persist `getState()` across reloads. We don't want a
  // half-loaded plan tab on the next launch (the chat card owns the source
  // of truth), so return an empty object. Obsidian removes orphaned views
  // gracefully when their state can't be hydrated.
  getState(): Record<string, unknown> {
    return {};
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  private render(): void {
    if (!this.state) return;
    // The first child is the title bar; the second is the content area.
    // Mirrors the convention used by ApplyView / Obsidian's built-ins.
    const contentEl = this.containerEl.children[1];
    // Create the React root exactly once and reuse it on subsequent
    // renders. Re-emptying the container would detach the node `this.root`
    // is bound to, leaving React writing into an orphaned DOM subtree.
    if (!this.root) {
      contentEl.empty();
      const rootEl = contentEl.createDiv();
      this.root = createRoot(rootEl);
    }
    this.root.render(<PlanPreviewRoot app={this.app} state={this.state} />);
  }
}

interface PlanPreviewRootProps {
  app: App;
  state: PlanPreviewViewState;
}

/**
 * Render the live current plan when a `chatBackend` is wired through;
 * otherwise fall back to the static seed `state` (used for stateless
 * Obsidian workspace re-hydration).
 */
const PlanPreviewRoot: React.FC<PlanPreviewRootProps> = ({ app, state }) => {
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user has already acted from this tab — the buttons
  // disappear after a click so re-clicks can't double-resolve the proposal.
  // Reset whenever the plan id or revision changes (a new review or an
  // in-place revision).
  const [decided, setDecided] = useState(false);

  // Live current plan from the backend, or null when the plan was resolved /
  // mode left plan. Falls back to the seed state when no backend is wired.
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(
    () => state.chatBackend?.getCurrentPlan() ?? null
  );

  useEffect(() => {
    const backend = state.chatBackend;
    if (!backend) return;
    setCurrentPlan(backend.getCurrentPlan());
    return backend.subscribe(() => {
      setCurrentPlan(backend.getCurrentPlan());
    });
  }, [state.chatBackend]);

  // Resolve the markdown / title / decision actions to render. Live state
  // wins when present, otherwise fall back to the seed (handles the case
  // where the view is opened without a backend reference).
  const planMarkdown = currentPlan ? planBodyToMarkdown(currentPlan.body) : state.planMarkdown;
  const title = currentPlan?.title?.trim() || state.title?.trim() || "Plan proposal";
  const liveProposalId = currentPlan?.id ?? state.proposalId;
  const liveRevision = currentPlan?.revision ?? 0;
  const isPending = currentPlan?.decision === "pending";

  // Reset the per-tab decided flag whenever the plan identity OR the
  // in-place revision changes — the user gets fresh Approve/Reject
  // buttons for the new content.
  useEffect(() => {
    setDecided(false);
  }, [liveProposalId, liveRevision]);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target) return;
    target.classList.add("markdown-rendered");
    target.empty();
    // `MarkdownRenderer` requires a `Component` for cleanup of internal
    // listeners (links, embeds). We own this lifecycle for the duration of
    // the effect — unloading drops every subscription it set up.
    const component = new Component();
    component.load();
    MarkdownRenderer.render(app, planMarkdown, target, "", component).catch((e) => {
      logWarn("[PlanPreviewView] markdown render failed", e);
    });
    return () => {
      component.unload();
      target.empty();
    };
  }, [app, planMarkdown]);

  const decide = async (decision: PlanDecisionAction) => {
    if (decided) return;
    setDecided(true);
    if (!state.chatBackend || !currentPlan) return;
    const proposalId = currentPlan.id;
    try {
      await state.chatBackend.resolvePlanProposal(proposalId, decision);
      if (decision === "approve") closePlanPreview(app, proposalId);
    } catch (e) {
      logWarn("[PlanPreviewView] resolvePlanProposal failed", e);
    }
  };

  const canDecide = !decided && state.chatBackend && currentPlan && isPending;

  // No live plan AND we've outlived the seed (user already decided / mode
  // left plan). Render an explicit empty state instead of stale content.
  const showEmpty = state.chatBackend && !currentPlan;

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <FileText className="tw-size-4 tw-shrink-0 tw-text-muted" />
          <div className="tw-truncate tw-text-sm tw-font-medium">{title}</div>
          <span className="tw-rounded tw-bg-secondary tw-px-2 tw-py-0.5 tw-text-xs tw-text-muted">
            Read-only
          </span>
        </div>
        {canDecide ? (
          <div className="tw-flex tw-items-center tw-gap-2">
            <Button variant="destructive" size="sm" onClick={() => void decide("reject")}>
              <XIcon className="tw-size-4" />
              Reject
            </Button>
            <Button variant="success" size="sm" onClick={() => void decide("approve")}>
              <Check className="tw-size-4" />
              Approve
            </Button>
          </div>
        ) : null}
      </div>
      {showEmpty ? (
        <div className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-6 tw-py-4 tw-text-sm tw-text-muted">
          Plan no longer pending. Switch back to plan mode to start a new review.
        </div>
      ) : (
        <div ref={renderTargetRef} className="tw-flex-1 tw-overflow-auto tw-px-6 tw-py-4" />
      )}
    </div>
  );
};

/**
 * Close any open plan-preview tab(s) bound to the given proposal id. Used
 * after the user approves the plan so the read-only preview doesn't linger
 * once the agent has switched to `default` mode.
 */
export function closePlanPreview(app: App, proposalId: string): void {
  for (const leaf of app.workspace.getLeavesOfType(PLAN_PREVIEW_VIEW_TYPE)) {
    if ((leaf.view as PlanPreviewView).getProposalId() === proposalId) {
      leaf.detach();
    }
  }
}

/**
 * Open (or reveal) the plan-preview tab for the given proposal. Reuses an
 * existing tab when one is already open for the same proposal id so
 * clicking Open multiple times doesn't fan out duplicate views.
 */
export async function openPlanPreview(app: App, state: PlanPreviewViewState): Promise<void> {
  const existing = app.workspace
    .getLeavesOfType(PLAN_PREVIEW_VIEW_TYPE)
    .find((l) => (l.view as PlanPreviewView).getProposalId() === state.proposalId);
  if (existing) {
    await (existing.view as PlanPreviewView).setState(state);
    app.workspace.revealLeaf(existing);
    return;
  }
  const leaf = app.workspace.getLeaf(true);
  // Pass state through `setViewState` so Obsidian's lifecycle invokes
  // `setState(state, ...)` exactly once with the real payload. Calling
  // `setState` manually after a stateless `setViewState` led to the view
  // first rendering with `{}` and binding React's root to a node that the
  // next render then detached — leaving the visible tab empty.
  await leaf.setViewState({
    type: PLAN_PREVIEW_VIEW_TYPE,
    active: true,
    state: state as unknown as Record<string, unknown>,
  });
  app.workspace.revealLeaf(leaf);
}
