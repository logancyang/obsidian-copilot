import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { CurrentPlan, PlanDecisionAction } from "@/agentMode/session/types";

export type DecidablePlan = CurrentPlan & { pendingToolCallId: string };

// The session's plan proposal when a decision on it can be applied now, else null. Codex
// publishes the card from its tool call before the permission request; deciding earlier would
// hide the card and leave that request unanswered.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/551
export function findDecidablePlan(session: AgentSession, proposalId: string): DecidablePlan | null {
  const plan = session.getCurrentPlan();
  if (!plan || plan.id !== proposalId || plan.decision !== "pending") return null;
  if (!plan.permissionGated || !plan.pendingToolCallId) return null;
  if (!session.hasPendingPlanPermission()) return null;
  return { ...plan, pendingToolCallId: plan.pendingToolCallId };
}

// Applies the user's decision on a plan proposal and resolves once any follow-up turn it starts
// has been sent. Some adapters end the turn on plan rejection without consuming a deny message,
// so their feedback must become a new user turn once the running one settles.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/41
export async function applyPlanDecision(
  session: AgentSession,
  plan: DecidablePlan,
  decision: PlanDecisionAction,
  feedbackText?: string
): Promise<void> {
  const trimmedFeedback = decision === "feedback" ? feedbackText?.trim() : undefined;
  const sendNextTurn = !!trimmedFeedback && session.planFeedbackDelivery === "next_turn";
  const pendingTurn = session.getLastTurn();
  session.resolvePlanProposalPermission(
    plan.pendingToolCallId,
    decision === "approve",
    sendNextTurn ? undefined : trimmedFeedback
  );
  session.finalizePlanDecision(plan.id, decision, trimmedFeedback);
  if (sendNextTurn) {
    await pendingTurn;
    await session.sendPrompt(trimmedFeedback).turn;
  }
}
