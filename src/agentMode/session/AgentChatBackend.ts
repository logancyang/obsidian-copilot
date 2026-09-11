import type { AgentHistoryRestoreStatus } from "./agentChatSnapshot";
import type {
  AgentQueuedTask,
  AgentQueueHoldReason,
  AgentTaskAcceptance,
} from "./AgentTaskCoordinator";
import type {
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskSubmission,
  AgentVoiceControls,
  AgentVoiceRuntimeState,
} from "./voiceTypes";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanDecisionAction,
  PlanUsage,
  SessionUsage,
} from "./types";

/**
 * Narrow interface the Agent Mode UI tree consumes. Implemented by
 * `AgentChatUIState`. Distinct from the legacy `ChatUIState` because Agent
 * Mode has no edit/regenerate/persistence flow and no chain-type or
 * include-active-note plumbing — ACP owns those concerns server-side.
 *
 * Work is requested through {@link submitTask} rather than a fire-and-await
 * send: the session's task owner decides whether a submission runs now or
 * queues, and reports completion through {@link onTaskSettled}. A resolved
 * promise here would not be proof that the backend succeeded.
 */
export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  /**
   * Hand an immutable request to the conversation's task owner. Returns
   * synchronously with the assigned task id and whether it started or queued.
   */
  submitTask(submission: AgentTaskSubmission): AgentTaskAcceptance;
  /**
   * Report what one composer currently allows. The composer holds while its
   * project's context materializes and while it cannot accept work.
   *
   * @param reason - Why this composer holds dispatch, or null to let it run.
   * @param holderId - Identity of the reporting composer; one per mounted instance.
   */
  setQueueHold(reason: AgentQueueHoldReason | null, holderId?: string): void;
  /**
   * Drop an unmounted composer. Dispatch keeps running while another composer
   * (a popout of the same chat) is still mounted, and parks once the last one
   * goes so a backgrounded conversation never flushes its queue.
   */
  releaseQueueHold(holderId?: string): void;
  /** Submissions waiting for the session to free up, in send order. */
  getQueuedTasks(): readonly AgentQueuedTask[];
  /** Drop a queued submission the user dismissed. */
  removeQueuedTask(taskId: string): boolean;
  /** The task the backend is running, or null when idle. */
  getActiveTask(): AgentTaskRecord | null;
  /** Observe settled task outcomes, including failures. */
  onTaskSettled(listener: (result: AgentTaskResult) => void): () => void;
  /** Stop: discard queued submissions first, then cancel the active turn. */
  cancelActiveAndClearQueue(): Promise<void>;
  /**
   * What the loader recovered from this chat's saved file, when the surface
   * has a session behind it. Optional because a non-agent chat host has no
   * saved agent conversation to report on.
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
   */
  getHistoryRestoreStatus?(): AgentHistoryRestoreStatus;
  /**
   * Current state of the spoken channel for this conversation. Optional
   * because a host with no voice wiring has no call to describe; it reports
   * the off state.
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
   */
  getVoiceState?(): AgentVoiceRuntimeState;
  /**
   * Start, end, and mute the spoken channel for this conversation, or null
   * where voice is unavailable (mobile, feature off, no wiring attached).
   */
  getVoiceControls?(): AgentVoiceControls | null;
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
   * Latest backend-agnostic token-usage snapshot for the session, or `null`
   * when none has been reported yet (fresh session, or a resumed chat with no
   * persisted usage). The UI renders this as a context-window indicator.
   */
  getSessionUsage(): SessionUsage | null;

  /**
   * Latest account-level plan-cap snapshot, or `null` when this backend reports none —
   * either because it has no usage API, or because plan caps do not apply to how the
   * user authenticated (an API key rather than a subscription).
   */
  getPlanUsage(): PlanUsage | null;

  /**
   * True when an ExitPlanMode permission is currently pending. The chat input
   * disables itself while one is outstanding so the user is funneled to the
   * proposal card's actions.
   */
  hasPendingPlanPermission(): boolean;

  /**
   * Snapshot of every non-plan tool-permission request currently waiting on
   * the user. Rendered as `ToolPermissionCard`s in the chat action rail.
   * Empty list when nothing is pending.
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
   * Rendered as `AskUserQuestionCard`s in the chat action rail alongside any
   * `ToolPermissionCard`s. Empty list when none.
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
