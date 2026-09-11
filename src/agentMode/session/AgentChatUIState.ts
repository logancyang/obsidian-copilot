import type { AgentHistoryRestoreStatus } from "@/agentMode/session/agentChatSnapshot";
import { logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  AgentQueuedTask,
  AgentQueueHoldReason,
  AgentTaskAcceptance,
} from "@/agentMode/session/AgentTaskCoordinator";
import type {
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskSubmission,
} from "@/agentMode/session/voiceTypes";
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
} from "@/agentMode/session/types";

/**
 * `AgentChatBackend` implementation backed by an `AgentSession`. The Agent
 * Mode UI tree consumes this exclusively — it knows nothing about the legacy
 * `ChatUIState` / `ChatManager` stack.
 *
 * Edit, regenerate, and persistence operations are intentionally absent —
 * they don't have ACP semantics and Agent Mode chat persistence is deferred.
 */
export class AgentChatUIState implements AgentChatBackend {
  private listeners = new Set<() => void>();

  constructor(private readonly session: AgentSession) {
    // Forward message, status, and model changes. The chat UI gates the
    // send button on `isStarting()`, so it needs to re-render when status
    // transitions out of `"starting"`.
    this.session.subscribe({
      onMessagesChanged: () => this.notifyListeners(),
      onStatusChanged: () => this.notifyListeners(),
      onModelChanged: () => this.notifyListeners(),
      onCurrentPlanChanged: () => this.notifyListeners(),
      onCurrentTodoListChanged: () => this.notifyListeners(),
    });
    // Queue and active-task changes are part of the same runtime snapshot the
    // UI reads, so they ride the one listener set.
    this.session.tasks.subscribe(() => this.notifyListeners());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentChatUIState] listener threw", e);
      }
    }
  }

  submitTask(submission: AgentTaskSubmission): AgentTaskAcceptance {
    const acceptance = this.session.tasks.submit(submission);
    this.notifyListeners();
    return acceptance;
  }

  setQueueHold(reason: AgentQueueHoldReason | null, holderId?: string): void {
    this.session.tasks.setDispatchHold(reason, holderId);
  }

  releaseQueueHold(holderId?: string): void {
    this.session.tasks.releaseDispatchHold(holderId);
  }

  getQueuedTasks(): readonly AgentQueuedTask[] {
    return this.session.tasks.getQueuedTasks();
  }

  removeQueuedTask(taskId: string): boolean {
    return this.session.tasks.removeQueuedTask(taskId);
  }

  getActiveTask(): AgentTaskRecord | null {
    return this.session.tasks.getActiveTask();
  }

  onTaskSettled(listener: (result: AgentTaskResult) => void): () => void {
    return this.session.tasks.onTaskSettled(listener);
  }

  async cancelActiveAndClearQueue(): Promise<void> {
    await this.session.tasks.cancelActiveAndClearQueue();
  }

  getHistoryRestoreStatus(): AgentHistoryRestoreStatus {
    return this.session.getHistoryRestoreStatus();
  }

  async deleteMessage(id: string): Promise<boolean> {
    // Refuse delete during an in-flight turn: the placeholder assistant
    // message is what streaming notifications target, and removing it would
    // leave the session writing into a vanished id.
    const status = this.session.getStatus();
    if (status === "running" || status === "awaiting_permission") {
      logWarn("[AgentChatUIState] delete refused while turn is in flight");
      return false;
    }
    const ok = this.session.store.deleteMessage(id);
    if (ok) this.notifyListeners();
    return ok;
  }

  clearMessages(): void {
    this.session.store.clear();
    this.notifyListeners();
  }

  getMessages(): AgentChatMessage[] {
    return this.session.store.getDisplayMessages();
  }

  isStarting(): boolean {
    return this.session.getStatus() === "starting";
  }

  getBackendState(): BackendState | null {
    return this.session.getState();
  }

  canSwitchModel(): boolean | null {
    return this.session.canSwitchModel();
  }

  canSwitchEffort(): boolean | null {
    return this.session.canSwitchEffort();
  }

  canSwitchMode(): boolean | null {
    return this.session.canSwitchMode();
  }

  hasPendingPlanPermission(): boolean {
    return this.session.hasPendingPlanPermission();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.session.getPendingToolPermissions();
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    this.session.resolveToolPermission(toolCallId, optionId);
    this.notifyListeners();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return this.session.getPendingAskUserQuestions();
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    this.session.resolveAskUserQuestion(requestId, answers);
    this.notifyListeners();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.session.getCurrentPlan();
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.session.getCurrentTodoList();
  }

  getSessionUsage(): SessionUsage | null {
    return this.session.getSessionUsage();
  }

  getPlanUsage(): PlanUsage | null {
    return this.session.getPlanUsage();
  }

  async resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void> {
    const plan = this.session.getCurrentPlan();
    if (!plan || plan.id !== proposalId || plan.decision !== "pending") return;
    if (!plan.permissionGated || !plan.pendingToolCallId) {
      logWarn("[AgentChatUIState] non-gated plan card has no resolution path");
      return;
    }
    const trimmedFeedback = decision === "feedback" ? feedbackText?.trim() : undefined;
    // Resolve the underlying ACP permission. Approve unblocks the agent
    // and continues the same turn; reject denies with `"User declined"`;
    // feedback rides the typed text through the same deny `message` so
    // the agent revises in-turn instead of receiving a separate
    // follow-up prompt.
    this.session.resolvePlanProposalPermission(
      plan.pendingToolCallId,
      decision === "approve",
      trimmedFeedback
    );
    this.session.finalizePlanDecision(plan.id);
    this.notifyListeners();
  }
}
