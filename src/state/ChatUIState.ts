import { ChainType } from "@/chainFactory";
import { logInfo } from "@/logger";
import { ChatManager } from "@/core/ChatManager";
import { ChatMessage, MessageContext } from "@/types/message";

/**
 * ChatUIState - Clean UI-only state manager
 *
 * This replaces SharedState with a minimal, focused approach:
 * - Only handles UI state and React integration
 * - Delegates all business logic to ChatManager
 * - Provides subscription mechanism for React components
 * - No complex recovery or validation logic
 */
export class ChatUIState {
  private listeners: Set<() => void> = new Set();

  constructor(private chatManager: ChatManager) {}

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
    includeActiveNote: boolean = false
  ): Promise<string> {
    const messageId = await this.chatManager.sendMessage(
      displayText,
      context,
      chainType,
      includeActiveNote
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
   * Add a display-only message (for AI responses)
   */
  addDisplayMessage(text: string, sender: string, id?: string): string {
    const messageId = this.chatManager.addDisplayMessage(text, sender, id);
    this.notifyListeners();
    return messageId;
  }

  /**
   * Add a full message object
   */
  addFullMessage(message: ChatMessage): string {
    const messageId = this.chatManager.addFullMessage(message);
    this.notifyListeners();
    return messageId;
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
   * Legacy compatibility - add message with visibility logic
   */
  addMessage(message: ChatMessage): void {
    if (message.isVisible) {
      this.addDisplayMessage(message.message, message.sender, message.id);
    } else {
      this.addFullMessage(message);
    }
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
}
