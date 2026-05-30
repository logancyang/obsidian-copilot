import { logError, logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanDecisionAction,
  PromptContent,
} from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";

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
    });
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

  /**
   * Append a user message and kick off the ACP turn. Returns the new user
   * message id synchronously plus a `turn` promise the caller can await for
   * loading-state lifecycle (Stop button, input lock).
   */
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { id: string; turn: Promise<void> } {
    const { userMessageId, turn } = this.session.sendPrompt(text, context, promptContent);
    this.notifyListeners();
    const wrapped = turn.then(
      () => undefined,
      (err) => {
        logError("[AgentMode] turn failed", err);
      }
    );
    return { id: userMessageId, turn: wrapped };
  }

  async cancel(): Promise<void> {
    await this.session.cancel();
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
