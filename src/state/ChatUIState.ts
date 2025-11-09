import { ChainType } from "@/chainFactory";
import { logInfo } from "@/logger";
import { ChatManager } from "@/core/ChatManager";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

/**
 * ChatUIState - Clean UI-only state manager
 *
 * This replaces SharedState with a minimal, focused approach:
 * - Only handles UI state and React integration
 * - Delegates all business logic to ChatManager
 * - Provides subscription mechanism for React components
 * - No complex recovery or validation logic
 * - Uses setTimeout scheduling to ensure React completes renders before state notifications
 */
export class ChatUIState {
  private listeners: Set<() => void> = new Set();

  constructor(private chatManager: ChatManager) {
    // Set up callback for immediate UI updates when messages are created
    this.chatManager.setOnMessageCreatedCallback(() => {
      this.scheduleNotify();
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
   * Schedule notification to occur after current render completes.
   * Uses setTimeout to push notification to next event loop tick, ensuring React
   * has completed its current render cycle before the state change notification.
   *
   * Note: No debouncing - multiple state changes will queue multiple timeouts.
   * This is intentional to ensure all state changes trigger re-renders.
   */
  private scheduleNotify(): void {
    // Use setTimeout(0) to push to next event loop tick
    // This gives React time to complete current render before notification
    setTimeout(() => {
      this.listeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          logInfo(`[ChatUIState] Error in listener:`, error);
        }
      });
    }, 0);
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
    content?: any[]
  ): Promise<string> {
    const messageId = await this.chatManager.sendMessage(
      displayText,
      context,
      chainType,
      includeActiveNote,
      content
    );
    this.scheduleNotify();
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
      this.scheduleNotify();
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
        this.scheduleNotify();
      },
      () => {
        // Notify immediately after truncation
        this.scheduleNotify();
      }
    );
    if (success) {
      this.scheduleNotify();
    }
    return success;
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    const success = await this.chatManager.deleteMessage(messageId);
    if (success) {
      this.scheduleNotify();
    }
    return success;
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.chatManager.clearMessages();
    this.scheduleNotify();
  }

  /**
   * Truncate messages after a specific message ID
   */
  async truncateAfterMessageId(messageId: string): Promise<void> {
    await this.chatManager.truncateAfterMessageId(messageId);
    this.scheduleNotify();
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
    this.scheduleNotify();
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
    this.scheduleNotify();
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
    this.scheduleNotify();
  }

  /**
   * Handle project switch
   */
  async handleProjectSwitch(): Promise<void> {
    await this.chatManager.handleProjectSwitch();
    this.scheduleNotify();
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
    this.scheduleNotify();
  }
}
