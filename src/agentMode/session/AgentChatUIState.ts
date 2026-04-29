import { logError, logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
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

  constructor(private readonly session: AgentSession) {
    // Forward message, status, and model changes. The chat UI gates the
    // send button on `isStarting()`, so it needs to re-render when status
    // transitions out of `"starting"`.
    this.session.subscribe({
      onMessagesChanged: () => this.notifyListeners(),
      onStatusChanged: () => this.notifyListeners(),
      onModelChanged: () => this.notifyListeners(),
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
}
