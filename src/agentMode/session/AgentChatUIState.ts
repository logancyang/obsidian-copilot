import { logError, logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  BackendDescriptor,
  CurrentPlan,
  PlanDecisionAction,
} from "@/agentMode/session/types";
import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@agentclientprotocol/sdk";
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

  constructor(
    private readonly session: AgentSession,
    private readonly descriptor: BackendDescriptor
  ) {
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
    content?: any[]
  ): { id: string; turn: Promise<void> } {
    const { userMessageId, turn } = this.session.sendPrompt(text, context, content);
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

  getModelState(): SessionModelState | null {
    return this.session.getModelState();
  }

  async setModel(modelId: string): Promise<void> {
    await this.session.setModel(modelId);
  }

  isModelSwitchSupported(): boolean | null {
    return this.session.isModelSwitchSupported();
  }

  getConfigOptions(): SessionConfigOption[] | null {
    return this.session.getConfigOptions();
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    await this.session.setConfigOption(configId, value);
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return this.session.isSetSessionConfigOptionSupported();
  }

  getModeState(): SessionModeState | null {
    return this.session.getModeState();
  }

  async setMode(modeId: string): Promise<void> {
    await this.session.setMode(modeId);
  }

  isSetModeSupported(): boolean | null {
    return this.session.isSetModeSupported();
  }

  hasPendingPlanPermission(): boolean {
    return this.session.hasPendingPlanPermission();
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
    const trimmedFeedback = decision === "feedback" ? feedbackText?.trim() : undefined;

    if (plan.permissionGated && plan.pendingToolCallId) {
      // Resolve the underlying ACP permission first; the agent unblocks and
      // (for approve) continues the same turn.
      this.session.resolvePlanProposalPermission(plan.pendingToolCallId, decision === "approve");

      if (trimmedFeedback) {
        // Wait for the agent to settle the now-denied turn before queuing the
        // follow-up — `sendPrompt` rejects when a turn is in flight.
        await this.session.waitForIdle();
        this.tryFollowUp(trimmedFeedback);
      }
    } else {
      // Non-gated path: OpenCode end-of-turn proposals, or Claude Code
      // post-rejection plan-file revisions where the underlying permission
      // was already resolved. Approve switches to canonical build and queues
      // a follow-up; Feedback sends the typed text; Reject is informational.
      if (decision === "approve") {
        await this.applyCanonicalBuildMode();
        this.tryFollowUp("Proceed with the plan.");
      } else if (trimmedFeedback) {
        this.tryFollowUp(trimmedFeedback);
      }
    }

    this.session.finalizePlanDecision(plan.id);
    this.notifyListeners();
  }

  private tryFollowUp(text: string): void {
    try {
      this.session.sendPrompt(text);
    } catch (e) {
      logWarn("[AgentChatUIState] failed to send plan follow-up", e);
    }
  }

  /**
   * Switch the session to canonical "build" mode by consulting the backend
   * descriptor's mode mapping. No-op when the descriptor doesn't advertise a
   * mapping (older/simpler backends) or when the build native id isn't
   * available. Errors are logged but never throw — the follow-up proceed
   * message still goes out.
   */
  private async applyCanonicalBuildMode(): Promise<void> {
    try {
      const mapping = this.descriptor.getModeMapping?.(
        this.session.getModeState(),
        this.session.getConfigOptions()
      );
      if (!mapping) return;
      const native = mapping.canonical.build;
      if (!native) return;
      if (mapping.kind === "setMode") {
        await this.session.setMode(native);
      } else if (mapping.configId) {
        await this.session.setConfigOption(mapping.configId, native);
      }
    } catch (e) {
      logWarn("[AgentChatUIState] could not switch to build mode after approve", e);
    }
  }
}
