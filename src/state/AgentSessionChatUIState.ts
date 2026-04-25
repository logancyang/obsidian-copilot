import { ChainType } from "@/chainFactory";
import { logError, logWarn } from "@/logger";
import { AgentSession } from "@/LLMProviders/agentMode/AgentSession";
import { ChatMessageContent, ChatUIState } from "@/state/ChatUIState";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

/**
 * `ChatUIState` implementation backed by an `AgentSession`. Used when the
 * active chain is `ChainType.AGENT_MODE`. Mirrors the public surface of
 * `ChatManagerChatUIState` so `<Chat />` and `useChatManager` don't need to
 * know which one they're talking to.
 *
 * Edit, regenerate, and persistence operations are intentionally stubbed —
 * Agent Mode messages have rich `agentParts` that don't yet round-trip
 * through `ChatPersistenceManager`, and edit/regenerate would need dedicated
 * ACP semantics.
 */
export class AgentSessionChatUIState implements ChatUIState {
  private listeners = new Set<() => void>();

  constructor(private readonly session: AgentSession) {
    this.session.subscribe({
      onMessagesChanged: () => this.notifyListeners(),
      onStatusChanged: () => this.notifyListeners(),
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
        logWarn("[AgentSessionChatUIState] listener threw", e);
      }
    }
  }

  async sendMessage(
    displayText: string,
    context: MessageContext,
    _chainType: ChainType,
    _includeActiveNote: boolean = false,
    _includeActiveWebTab: boolean = false,
    content?: ChatMessageContent
  ): Promise<string> {
    const { userMessageId, turn } = this.session.sendPrompt(displayText, context, content);
    this.notifyListeners();
    // Await the full turn so the caller's loading state stays accurate (Stop
    // button stays "Stop", input stays disabled) until the agent finishes
    // streaming. Errors surface via `markMessageError` in `runTurn` already,
    // so we just swallow here to keep the resolved-userMessageId contract.
    try {
      await turn;
    } catch (err) {
      logError("[AgentMode] turn failed", err);
    }
    return userMessageId;
  }

  async editMessage(): Promise<boolean> {
    return false;
  }

  async regenerateMessage(): Promise<boolean> {
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const ok = this.session.repo.deleteMessage(messageId);
    if (ok) this.notifyListeners();
    return ok;
  }

  clearMessages(): void {
    this.session.repo.clear();
    this.notifyListeners();
  }

  async truncateAfterMessageId(messageId: string): Promise<void> {
    this.session.repo.truncateAfterMessageId(messageId);
    this.notifyListeners();
  }

  getMessages(): ChatMessage[] {
    return this.session.repo.getDisplayMessages();
  }

  getMessage(id: string): ChatMessage | undefined {
    return this.session.repo.getMessage(id);
  }

  getLLMMessage(id: string): ChatMessage | undefined {
    return this.session.repo.getLLMMessage(id);
  }

  getLLMMessages(): ChatMessage[] {
    return this.session.repo.getLLMMessages();
  }

  get chatHistory(): ChatMessage[] {
    return this.getMessages();
  }

  addMessage(message: ChatMessage): void {
    this.session.repo.addMessage(message);
    this.notifyListeners();
  }

  clearChatHistory(): void {
    this.clearMessages();
  }

  replaceMessages(messages: ChatMessage[]): void {
    this.session.repo.loadMessages(messages);
    this.notifyListeners();
  }

  getDebugInfo(): unknown {
    return this.session.repo.getDebugInfo();
  }

  async loadMessages(messages: ChatMessage[]): Promise<void> {
    this.session.repo.loadMessages(messages);
    this.notifyListeners();
  }

  async handleProjectSwitch(): Promise<void> {
    // Agent Mode is single-session; no per-project isolation yet.
  }

  async saveChat(_modelKey: string): Promise<void> {
    // Persistence for Agent Mode messages (with agentParts) is not implemented.
  }

  async loadChatHistory(_file: TFile): Promise<void> {
    // See saveChat.
  }
}
