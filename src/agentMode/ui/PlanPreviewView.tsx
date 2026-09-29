import { Button } from "@/components/ui/button";
import { logWarn } from "@/logger";
import { useSessionSelector } from "@/agentMode/protocol/react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { SessionState } from "@/agentMode/protocol/state";
import type { CurrentPlan, PlanDecisionAction, SessionId } from "@/agentMode/session/types";
import { useSessionCommands } from "@/agentMode/ui/hooks/useSessionCommands";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Check, FileText, X as XIcon } from "lucide-react";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { App, Component, ItemView, WorkspaceLeaf } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { Root } from "react-dom/client";

export const PLAN_PREVIEW_VIEW_TYPE = "copilot-plan-preview-view";

export interface PlanPreviewViewState {
  proposalId: string;
  planMarkdown: string;
  title?: string;
  client: SessionClient;
  sessionId: SessionId;
}

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

  getProposalId(): string | undefined {
    return this.state?.proposalId;
  }

  async setState(state: PlanPreviewViewState): Promise<void> {
    if (!state || !state.planMarkdown) return;
    this.state = state;
    this.render();
  }

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
    const contentEl = this.containerEl.children[1];
    if (!this.root) {
      contentEl.empty();
      const rootEl = contentEl.createDiv();
      this.root = createPluginRoot(rootEl, this.app);
    }
    this.root.render(<PlanPreviewRoot app={this.app} state={this.state} />);
  }
}

export interface PlanPreviewRootProps {
  app: App;
  state: PlanPreviewViewState;
}

// A session's plan wrapped so "session not loaded yet" (null) differs from "no plan" (`plan: null`).
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
interface PlanSelection {
  plan: CurrentPlan | null;
}
const selectPlan = (session: SessionState): PlanSelection => ({ plan: session.plan });
const samePlan = (a: PlanSelection, b: PlanSelection) => a.plan === b.plan;

export const PlanPreviewRoot: React.FC<PlanPreviewRootProps> = ({ app, state }) => {
  const renderTargetRef = useRef<HTMLDivElement | null>(null);
  const [decided, setDecided] = useState(false);
  const { client, sessionId } = state;
  const commands = useSessionCommands(client, sessionId);

  useEffect(() => client.watchSession(sessionId), [client, sessionId]);
  const selectedPlan = useSessionSelector(client, sessionId, selectPlan, samePlan);
  const currentPlan = selectedPlan?.plan ?? null;

  const planMarkdown = currentPlan ? currentPlan.body : state.planMarkdown;
  const title = currentPlan?.title?.trim() || state.title?.trim() || "Plan proposal";
  const liveProposalId = currentPlan?.id ?? state.proposalId;
  const liveRevision = currentPlan?.revision ?? 0;
  const isPending = currentPlan?.decision === "pending";

  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- intentional reset on plan-identity change; the alternative (key prop remount) would also unmount the markdown renderer
    setDecided(false);
  }, [liveProposalId, liveRevision]);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target) return;
    target.classList.add("markdown-rendered");
    target.empty();
    const component = new Component();
    component.load();
    const sourcePath = app.workspace.getActiveFile()?.path ?? "";
    renderMarkdown(app, planMarkdown, target, sourcePath, component).catch((e: unknown) => {
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
    if (!currentPlan) return;
    const proposalId = currentPlan.id;
    await commands.resolvePlan(proposalId, decision);
    if (decision === "approve") closePlanPreview(app, proposalId);
  };

  const canDecide = !decided && currentPlan && isPending;

  const showEmpty = selectedPlan !== null && !currentPlan;

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <div className="copilot-divider-b tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-2">
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

export function closePlanPreview(app: App, proposalId: string): void {
  for (const leaf of app.workspace.getLeavesOfType(PLAN_PREVIEW_VIEW_TYPE)) {
    if (getPlanPreviewProposalId(leaf.view) === proposalId) {
      leaf.detach();
    }
  }
}

export async function openPlanPreview(app: App, state: PlanPreviewViewState): Promise<void> {
  const existing = app.workspace
    .getLeavesOfType(PLAN_PREVIEW_VIEW_TYPE)
    .find((l) => getPlanPreviewProposalId(l.view) === state.proposalId);
  if (existing) {
    await (existing.view as PlanPreviewView).setState(state);
    app.workspace.revealLeaf(existing);
    return;
  }
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({
    type: PLAN_PREVIEW_VIEW_TYPE,
    active: true,
    state: state,
  });
  app.workspace.revealLeaf(leaf);
}

function getPlanPreviewProposalId(view: unknown): string | undefined {
  const maybeView = view as { getProposalId?: () => unknown };
  if (typeof maybeView.getProposalId !== "function") return undefined;
  const result = maybeView.getProposalId();
  return typeof result === "string" ? result : undefined;
}
