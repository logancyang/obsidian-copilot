import type { MessageContext } from "@/types/message";
import type {
  AgentChatMessage,
  BackendState,
  CurrentPlan,
  PlanDecisionAction,
  PromptContent,
} from "./types";

/**
 * Narrow interface the Agent Mode UI tree consumes. Implemented by
 * `AgentChatUIState`. Distinct from the legacy `ChatUIState` because Agent
 * Mode has no edit/regenerate/persistence flow and no chain-type or
 * include-active-note plumbing — ACP owns those concerns server-side.
 *
 * `sendMessage` returns `{ id, turn }` so the caller can synchronously read
 * the new user message id (for input history) and separately await the full
 * turn for loading-state management.
 */
export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { id: string; turn: Promise<void> };
  cancel(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];

  /** True while ACP `session/new` is still in flight. Send is gated on this. */
  isStarting(): boolean;

  /** Latest unified picker state, or `null` while the backend session is still starting. */
  getBackendState(): BackendState | null;
  /**
   * Intent-level capability probes. Tri-state: null = not yet probed,
   * true/false = result. The session encapsulates wire routing
   * (descriptor-style vs suffix-style effort, `setMode` vs
   * `setConfigOption` mode dispatch) — UI consumers ask intent only.
   */
  canSwitchModel(): boolean | null;
  canSwitchEffort(): boolean | null;
  canSwitchMode(): boolean | null;

  /**
   * Resolve the current plan proposal the user has decided on. Branches on
   * `currentPlan.permissionGated`:
   *   - gated (Claude Code ExitPlanMode): resolves the underlying ACP
   *     permission as allow/deny. Approve auto-continues the agent's turn;
   *     Reject ends the turn; Feedback denies with `feedbackText` as the
   *     agent-visible deny reason.
   *   - non-gated (OpenCode end-of-turn, or backends whose plan-exit signal
   *     carries no permission): Approve switches to canonical `build` mode
   *     (when the descriptor advertises one) and sends a `Proceed with the
   *     plan.` follow-up; Reject is informational; Feedback sends
   *     `feedbackText` as the next user turn (mode stays in plan).
   *
   * `proposalId` must match the current `getCurrentPlan().id` — stale
   * resolutions (the user clicked a card that has since been replaced)
   * are silently ignored.
   */
  resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void>;

  /**
   * Singleton plan-mode review state, or `null` when there's nothing to
   * surface. The floating plan card and the editor preview tab read this.
   */
  getCurrentPlan(): CurrentPlan | null;

  /**
   * True when an ExitPlanMode permission is currently pending. The chat input
   * disables itself while one is outstanding so the user is funneled to the
   * proposal card's actions.
   */
  hasPendingPlanPermission(): boolean;
}
