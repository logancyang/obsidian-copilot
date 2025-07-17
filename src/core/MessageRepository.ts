import { formatDateTime } from "@/utils";
import { ChatMessage, MessageContext, NewChatMessage, StoredMessage } from "@/types/message";
import { logInfo } from "@/logger";

/**
 * MessageRepository - Single source of truth for all messages
 *
 * This implements a minimal clean architecture where:
 * - Each message is stored once with both display and processed text
 * - Display messages are computed views for UI
 * - LLM messages are computed views for AI communication
 * - No complex dual message systems or ID matching
 */
export class MessageRepository {
  private messages: StoredMessage[] = [];

  /**
   * Generate a unique message ID
   */
  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add a new message
   * For user messages: displayText is what they typed, processedText includes context
   * For AI messages: both are the same
   */
  addMessage(
    displayText: string,
    processedText: string,
    sender: string,
    context?: MessageContext
  ): string {
    const id = this.generateId();
    const timestamp = formatDateTime(new Date());

    const message: StoredMessage = {
      id,
      displayText,
      processedText,
      sender,
      timestamp,
      context,
      isVisible: true,
      isErrorMessage: false,
    };

    this.messages.push(message);
    logInfo(`[MessageRepository] Added message with ID: ${id}`);

    return id;
  }

  /**
   * Add a display-only message (for AI responses)
   * Both display and processed text are the same
   */
  addDisplayOnlyMessage(text: string, sender: string, id?: string): string {
    if (id) {
      const timestamp = formatDateTime(new Date());
      const message: StoredMessage = {
        id,
        displayText: text,
        processedText: text,
        sender,
        timestamp,
        isVisible: true,
        isErrorMessage: false,
      };
      this.messages.push(message);
      logInfo(`[MessageRepository] Added display-only message with ID: ${id}`);
      return id;
    }
    return this.addMessage(text, text, sender);
  }

  /**
   * Add a full message object (for compatibility)
   */
  addFullMessage(message: NewChatMessage): string {
    const id = message.id || this.generateId();
    const timestamp = message.timestamp || formatDateTime(new Date());

    const storedMessage: StoredMessage = {
      id,
      displayText: message.message,
      processedText: message.originalMessage || message.message,
      sender: message.sender,
      timestamp,
      context: message.context,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      sources: message.sources,
      content: message.content,
    };

    this.messages.push(storedMessage);
    logInfo(`[MessageRepository] Added full message with ID: ${id}`);
    return id;
  }

  /**
   * Edit a message's display text
   */
  editMessage(id: string, newDisplayText: string): boolean {
    const message = this.messages.find((msg) => msg.id === id);
    if (!message) {
      logInfo(`[MessageRepository] Message not found for edit: ${id}`);
      return false;
    }

    if (message.displayText === newDisplayText) {
      logInfo(`[MessageRepository] No changes needed for message: ${id}`);
      return true;
    }

    // Update display text
    message.displayText = newDisplayText;

    // For user messages, mark that processed text needs updating
    if (message.sender === "user" || message.sender === "USER") {
      // ProcessedText will be updated by ContextManager
      logInfo(`[MessageRepository] Edited user message ${id}, needs context reprocessing`);
    } else {
      // For AI messages, display and processed are the same
      message.processedText = newDisplayText;
      logInfo(`[MessageRepository] Edited AI message ${id}`);
    }

    return true;
  }

  /**
   * Update the processed text for a message (after context processing)
   */
  updateProcessedText(id: string, processedText: string): boolean {
    const message = this.messages.find((msg) => msg.id === id);
    if (!message) {
      logInfo(`[MessageRepository] Message not found for processed text update: ${id}`);
      return false;
    }

    message.processedText = processedText;
    logInfo(`[MessageRepository] Updated processed text for message ${id}`);
    return true;
  }

  /**
   * Delete a message
   */
  deleteMessage(id: string): boolean {
    const index = this.messages.findIndex((msg) => msg.id === id);
    if (index === -1) {
      logInfo(`[MessageRepository] Message not found for deletion: ${id}`);
      return false;
    }

    this.messages.splice(index, 1);
    logInfo(`[MessageRepository] Deleted message ${id}`);
    return true;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
    logInfo(`[MessageRepository] Cleared all messages`);
  }

  /**
   * Truncate messages after a specific index
   */
  truncateAfter(index: number): void {
    this.messages = this.messages.slice(0, index + 1);
    logInfo(`[MessageRepository] Truncated messages after index ${index}`);
  }

  /**
   * Truncate messages after a specific message ID
   */
  truncateAfterMessageId(messageId: string): void {
    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index !== -1) {
      this.messages = this.messages.slice(0, index + 1);
      logInfo(`[MessageRepository] Truncated messages after message ${messageId}`);
    }
  }

  /**
   * Get display messages (computed view for UI)
   * Shows displayText for all visible messages
   */
  getDisplayMessages(): ChatMessage[] {
    return this.messages
      .filter((msg) => msg.isVisible)
      .map((msg) => ({
        id: msg.id,
        message: msg.displayText,
        originalMessage: msg.displayText,
        sender: msg.sender,
        timestamp: msg.timestamp,
        isVisible: true,
        context: msg.context,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
      }));
  }

  /**
   * Get a specific message for LLM processing
   * Returns processedText (with context) for the message
   */
  getLLMMessage(id: string): ChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return undefined;

    return {
      id: msg.id,
      message: msg.processedText,
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: false, // LLM messages are not for display
      context: msg.context,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
    };
  }

  /**
   * Get all messages for LLM conversation history
   * Returns processedText for all messages
   */
  getLLMMessages(): ChatMessage[] {
    return this.messages.map((msg) => ({
      id: msg.id,
      message: msg.processedText,
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: false,
      context: msg.context,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
    }));
  }

  /**
   * Get a message by ID (returns display version)
   */
  getMessage(id: string): ChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return undefined;

    return {
      id: msg.id,
      message: msg.displayText,
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: msg.isVisible,
      context: msg.context,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
    };
  }

  /**
   * Load messages from persistence
   */
  loadMessages(messages: ChatMessage[]): void {
    this.clear();
    messages.forEach((msg) => {
      this.messages.push({
        id: msg.id || this.generateId(),
        displayText: msg.message,
        processedText: msg.originalMessage || msg.message,
        sender: msg.sender,
        timestamp: msg.timestamp || formatDateTime(new Date()),
        context: msg.context,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
      });
    });
    logInfo(`[MessageRepository] Loaded ${messages.length} messages`);
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    return {
      totalMessages: this.messages.length,
      visibleMessages: this.messages.filter((m) => m.isVisible).length,
      userMessages: this.messages.filter((m) => m.sender === "user" || m.sender === "USER").length,
      aiMessages: this.messages.filter((m) => m.sender === "AI" || m.sender === "assistant").length,
    };
  }
}
