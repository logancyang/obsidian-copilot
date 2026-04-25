import { ChainType } from "@/chainFactory";
import { logInfo } from "@/logger";
import { ChatManager } from "@/core/ChatManager";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

/** Rich content payload (images etc.) attached to a message. */
export type ChatMessageContent = NonNullable<ChatMessage["content"]>;

/**
 * Public surface used by `<Chat />`, `useChatManager`, and CopilotView for
 * legacy chains (LLM_CHAIN, VAULT_QA_CHAIN, COPILOT_PLUS_CHAIN, PROJECT_CHAIN).
 * Single implementation: `ChatManagerChatUIState`. Agent Mode uses the
 * narrower `AgentChatBackend` (in `src/LLMProviders/agentMode/`) instead and
 * never flows through this type.
 */
export interface ChatUIState {
  subscribe(listener: () => void): () => void;
  sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote?: boolean,
    includeActiveWebTab?: boolean,
    content?: ChatMessageContent,
    updateLoadingMessage?: (message: string) => void
  ): Promise<string>;
  editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote?: boolean
  ): Promise<boolean>;
  regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void
  ): Promise<boolean>;
  deleteMessage(messageId: string): Promise<boolean>;
  clearMessages(): void;
  truncateAfterMessageId(messageId: string): Promise<void>;
  getMessages(): ChatMessage[];
  getMessage(id: string): ChatMessage | undefined;
  getLLMMessage(id: string): ChatMessage | undefined;
  getLLMMessages(): ChatMessage[];
  readonly chatHistory: ChatMessage[];
  addMessage(message: ChatMessage): void;
  clearChatHistory(): void;
  replaceMessages(messages: ChatMessage[]): void;
  getDebugInfo(): unknown;
  loadMessages(messages: ChatMessage[]): Promise<void>;
  handleProjectSwitch(): Promise<void>;
  saveChat(modelKey: string): Promise<void>;
  loadChatHistory(file: TFile): Promise<void>;
}

/**
 * ChatManagerChatUIState - Clean UI-only state manager backed by ChatManager
 * (legacy chains: chat, copilot-plus, autonomous, project).
 *
 * - Only handles UI state and React integration
 * - Delegates all business logic to ChatManager
 * - Provides subscription mechanism for React components
 * - No complex recovery or validation logic
 */
export class ChatManagerChatUIState implements ChatUIState {
  private listeners: Set<() => void> = new Set();

  constructor(private chatManager: ChatManager) {
    // Set up callback for immediate UI updates when messages are created
    this.chatManager.setOnMessageCreatedCallback(() => {
      this.notifyListeners();
    });
  }

  // ================================
  // UI STATE MANAGEMENT
  // ================================

  /**
   * Subscribe to state changes for React integration
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logInfo(`[ChatUIState] Error in listener:`, error);
      }
    });
  }

  // ================================
  // BUSINESS LOGIC DELEGATION
  // ================================

  /**
   * Send a new message
   */
  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false,
    includeActiveWebTab: boolean = false,
    content?: ChatMessageContent,
    updateLoadingMessage?: (message: string) => void
  ): Promise<string> {
    const messageId = await this.chatManager.sendMessage(
      displayText,
      context,
      chainType,
      includeActiveNote,
      includeActiveWebTab,
      content,
      updateLoadingMessage
    );
    this.notifyListeners();
    return messageId;
  }

  /**
   * Edit an existing message
   */
  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    const success = await this.chatManager.editMessage(
      messageId,
      newText,
      chainType,
      includeActiveNote
    );
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  /**
   * Regenerate an AI response
   */
  async regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void
  ): Promise<boolean> {
    const success = await this.chatManager.regenerateMessage(
      messageId,
      onUpdateCurrentMessage,
      (message) => {
        onAddMessage(message);
        this.notifyListeners();
      },
      () => {
        // Notify immediately after truncation
        this.notifyListeners();
      }
    );
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    const success = await this.chatManager.deleteMessage(messageId);
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.chatManager.clearMessages();
    this.notifyListeners();
  }

  /**
   * Truncate messages after a specific message ID
   */
  async truncateAfterMessageId(messageId: string): Promise<void> {
    await this.chatManager.truncateAfterMessageId(messageId);
    this.notifyListeners();
  }

  // ================================
  // DATA ACCESS
  // ================================

  /**
   * Get messages for UI display
   */
  getMessages(): ChatMessage[] {
    return this.chatManager.getDisplayMessages();
  }

  /**
   * Get a specific message by ID (display version)
   */
  getMessage(id: string): ChatMessage | undefined {
    return this.chatManager.getMessage(id);
  }

  /**
   * Get a specific message for LLM processing
   */
  getLLMMessage(id: string): ChatMessage | undefined {
    return this.chatManager.getLLMMessage(id);
  }

  /**
   * Get LLM messages (for debugging/advanced use)
   */
  getLLMMessages(): ChatMessage[] {
    return this.chatManager.getLLMMessages();
  }

  // ================================
  // LEGACY COMPATIBILITY
  // ================================

  /**
   * Legacy compatibility - get messages
   */
  get chatHistory(): ChatMessage[] {
    return this.getMessages();
  }

  /**
   * Add a message
   */
  addMessage(message: ChatMessage): void {
    this.chatManager.addMessage(message);
    this.notifyListeners();
  }

  /**
   * Legacy compatibility - clear chat history
   */
  clearChatHistory(): void {
    this.clearMessages();
  }

  /**
   * Legacy compatibility - replace messages
   */
  replaceMessages(messages: ChatMessage[]): void {
    this.chatManager.loadMessages(messages);
    this.notifyListeners();
  }

  // ================================
  // DEBUG & UTILITIES
  // ================================

  /**
   * Get debug information
   */
  getDebugInfo() {
    return this.chatManager.getDebugInfo();
  }

  /**
   * Load messages from persistence
   */
  async loadMessages(messages: ChatMessage[]): Promise<void> {
    await this.chatManager.loadMessages(messages);
    this.notifyListeners();
  }

  /**
   * Handle project switch
   */
  async handleProjectSwitch(): Promise<void> {
    await this.chatManager.handleProjectSwitch();
    this.notifyListeners();
  }

  /**
   * Save current chat history
   */
  async saveChat(modelKey: string): Promise<void> {
    await this.chatManager.saveChat(modelKey);
  }

  /**
   * Load chat history from a file
   */
  async loadChatHistory(file: TFile): Promise<void> {
    await this.chatManager.loadChatHistory(file);
    this.notifyListeners();
  }
}
