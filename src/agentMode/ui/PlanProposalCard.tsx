import { Button } from "@/components/ui/button";
import { logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  CurrentPlan,
  PlanDecisionAction,
  PlanProposalDecision,
} from "@/agentMode/session/types";
import { closePlanPreview, openPlanPreview } from "@/agentMode/ui/PlanPreviewView";
import { Check, ClipboardList, FileText, Send, X as XIcon } from "lucide-react";
import { App } from "obsidian";
import React, { useEffect, useState } from "react";

const FEEDBACK_PLACEHOLDER = "Give feedback to redirect the plan…";

interface PlanProposalCardProps {
  plan: CurrentPlan;
  app: App;
  chatBackend: AgentChatBackend;
}

/**
 * Inline plan-review card. Rendered at the tail of the chat scroll
 * container while a plan is awaiting the user's decision; scrolls with
 * the conversation. Visible only while `plan.decision === "pending"` —
 * the parent gates the render so the user never sees a terminal
 * "Approved/Rejected" chip after acting.
 *
 * The card stays mounted across in-place plan revisions (`plan.id`
 * unchanged, `plan.revision` bumped) so the user's half-typed feedback
 * survives refreshed plan-exit signals. Transient state resets only when
 * the plan id changes (a new plan-mode review).
 *
 * The orchestration (resolving the ACP permission, switching modes for
 * non-gated backends, dispatching follow-up messages) lives in
 * `AgentChatBackend.resolvePlanProposal` — this component is purely
 * presentational + invokes that one entry point.
 */
export const PlanProposalCard: React.FC<PlanProposalCardProps> = ({ plan, app, chatBackend }) => {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const isPending = plan.decision === "pending";

  // Reset transient state when the user enters a fresh plan-mode review
  // (different `plan.id`). In-place revisions keep the typed feedback.
  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- reset on plan-identity change; in-place revisions deliberately keep typed feedback so a key-prop remount would lose user input
    setFeedback("");
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- reset on plan-identity change
    setBusy(false);
  }, [plan.id]);

  const handleOpen = async () => {
    try {
      await openPlanPreview(app, {
        proposalId: plan.id,
        planMarkdown: plan.body,
        title: plan.title,
        chatBackend,
      });
    } catch (e) {
      logWarn("[PlanProposalCard] failed to open preview", e);
    }
  };

  const decide = async (decision: PlanDecisionAction, text?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await chatBackend.resolvePlanProposal(plan.id, decision, text);
      if (decision === "approve") closePlanPreview(app, plan.id);
    } finally {
      setBusy(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    const text = feedback.trim();
    if (!text) return;
    await decide("feedback", text);
    setFeedback("");
  };

  return (
    <div className="tw-mx-3 tw-my-2 tw-w-[calc(100%-1.5rem)] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      <div className="copilot-divider-b tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <ClipboardList className="tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-truncate tw-text-sm tw-font-medium">
            {plan.title || "Plan proposed"}
          </div>
        </div>
        <DecisionChip decision={plan.decision} />
      </div>

      <div className="tw-px-3 tw-py-2">
        <PlanTeaser plan={plan} />
      </div>

      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-2">
        <Button variant="secondary" size="sm" onClick={handleOpen}>
          <FileText className="tw-size-4" />
          Open
        </Button>
        {isPending ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => decide("reject")}
            >
              <XIcon className="tw-size-4" />
              Reject
            </Button>
            <Button variant="success" size="sm" disabled={busy} onClick={() => decide("approve")}>
              <Check className="tw-size-4" />
              Approve
            </Button>
          </>
        ) : null}
      </div>

      {isPending ? (
        <div className="tw-flex tw-items-stretch tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-2">
          <textarea
            className="tw-min-h-9 tw-flex-1 tw-resize-y tw-rounded tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-sm tw-text-normal tw-outline-none focus:tw-border-border-focus"
            placeholder={FEEDBACK_PLACEHOLDER}
            value={feedback}
            disabled={busy}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleFeedbackSubmit();
              }
            }}
            rows={2}
          />
          <Button
            variant="default"
            size="sm"
            disabled={busy || feedback.trim().length === 0}
            onClick={() => void handleFeedbackSubmit()}
          >
            <Send className="tw-size-4" />
            Send
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const DECISION_CHIP: Record<PlanProposalDecision, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "tw-bg-modifier-message tw-text-muted" },
  approved: { label: "Approved", cls: "tw-bg-success tw-text-success" },
  rejected: { label: "Rejected", cls: "tw-bg-error tw-text-error" },
  rejected_with_feedback: { label: "Feedback sent", cls: "tw-bg-error tw-text-error" },
};

const DecisionChip: React.FC<{ decision: PlanProposalDecision }> = ({ decision }) => {
  const { label, cls } = DECISION_CHIP[decision];
  return <span className={`tw-rounded tw-px-2 tw-py-0.5 tw-text-xs ${cls}`}>{label}</span>;
};

const PlanTeaser: React.FC<{ plan: CurrentPlan }> = ({ plan }) => (
  <pre className="tw-m-0 tw-whitespace-pre-wrap tw-break-words tw-text-xs tw-text-muted">
    {teaserFromMarkdown(plan.body)}
  </pre>
);

/**
 * Pull a 4-line teaser out of the markdown body, skipping leading blank
 * lines. Showing the heading + a few bullets is usually enough to convey
 * what the plan is about; the full text lives in the editor preview.
 */
function teaserFromMarkdown(md: string): string {
  const lines = md.split("\n").filter((l, i) => !(i === 0 && l.trim() === ""));
  return lines.slice(0, 4).join("\n");
}
