import type { MessageContext } from "@/types/message";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendId,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
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
  /**
   * Append a user message and start the turn. `mentionedAgents` is the resolved
   * answerer selection (the deduped `@`-mentioned installed agents, which may or
   * may not include the main agent). Present only when the turn fans out; absent
   * for the single-agent path (no qualifying mentions, or only the main agent
   * `@`-ed). Consumed by the fan-out orchestration via
   * `AgentSession.getLastMentionedAgents()`; the main agent summarizes separately.
   */
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
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
   * The session's live execution todo list (normalized from every backend's
   * todo channel), or `null` when there is none. Live-only: a resumed session
   * starts at `null` until the agent's next todo update. The project-info
   * Progress section reads this.
   */
  getCurrentTodoList(): AgentTodoListEntry[] | null;

  /**
   * True when an ExitPlanMode permission is currently pending. The chat input
   * disables itself while one is outstanding so the user is funneled to the
   * proposal card's actions.
   */
  hasPendingPlanPermission(): boolean;

  /**
   * Snapshot of every non-plan tool-permission request currently waiting on
   * the user. Rendered as inline `ToolPermissionCard`s at the tail of the
   * chat scroll container. Empty list when nothing is pending.
   */
  getPendingToolPermissions(): PermissionPrompt[];

  /**
   * Resolve a pending tool permission with the option the user picked. The
   * card is removed from `getPendingToolPermissions()` synchronously and the
   * SDK turn unblocks. No-op when no permission is pending for the given id.
   */
  resolveToolPermission(toolCallId: string, optionId: string): void;

  /**
   * Snapshot of every pending AskUserQuestion request waiting on the user.
   * Rendered as inline `AskUserQuestionCard`s at the tail of the chat scroll
   * container, alongside any `ToolPermissionCard`s. Empty list when none.
   */
  getPendingAskUserQuestions(): AskUserQuestionPrompt[];

  /**
   * Resolve a pending AskUserQuestion with the user's answers. The card is
   * removed from `getPendingAskUserQuestions()` synchronously and the SDK turn
   * unblocks. An empty map signals cancellation (the backend produces the
   * "User cancelled the question" deny). No-op when no question is pending for
   * the given id.
   */
  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void;
}
