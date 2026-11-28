export type PlanProposalDecision = "pending" | "approved" | "rejected" | "rejected_with_feedback";

export type PlanDecisionAction = "approve" | "reject" | "feedback";

export interface CurrentPlan {
  id: string;
  revision: number;
  body: string;
  title: string;
  sourceFilePath?: string;
  permissionGated: boolean;
  pendingToolCallId?: string;
  decision: PlanProposalDecision;
}
