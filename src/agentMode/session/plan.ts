/**
 * Decision state surfaced on the floating plan card. `pending` shows the
 * action row; the three terminal states collapse it (the card itself is
 * cleared shortly after by the session, so terminal states are a brief
 * transition, not a persistent display state).
 */
export type PlanProposalDecision = "pending" | "approved" | "rejected" | "rejected_with_feedback";

/** UI action the user invokes from the plan card; resolves into a `PlanProposalDecision`. */
export type PlanDecisionAction = "approve" | "reject" | "feedback";

/**
 * Session-level "current plan" singleton. There is at most one of these per
 * session; while the session is in canonical plan mode and a plan exists,
 * the UI renders one floating card pinned to the chat bottom. Updates
 * (Claude re-issuing ExitPlanMode) bump `revision` in place rather than
 * spawning additional cards.
 */
export interface CurrentPlan {
  /**
   * Stable id for the plan-mode "review session". Held constant across
   * in-place revisions so React state on the card and preview tab stays
   * mounted. Reset only when the user resolves the plan or leaves plan
   * mode.
   */
  id: string;
  /** Bumped on every body refresh — used by UI consumers to reset transient state. */
  revision: number;
  /** Markdown body shown in the card teaser and the preview tab. */
  body: string;
  /** Best-effort title (heading or first line of the body). */
  title: string;
  /**
   * Path of the plan markdown file the agent owns (Claude Code populates this
   * via `ExitPlanMode.rawInput.planFilePath`). Stored as metadata only.
   */
  sourceFilePath?: string;
  /**
   * `true` while a live `ExitPlanMode` permission is awaiting the user's
   * decision. Approve resolves with `allow_once`, Reject with `reject_once`,
   * Feedback rejects + queues the typed message as a follow-up turn.
   */
  permissionGated: boolean;
  /** ToolCallId of the live permission, when `permissionGated` is true. */
  pendingToolCallId?: string;
  /** Transient state — typically `pending`; the session clears the plan after a terminal decision. */
  decision: PlanProposalDecision;
}
