import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { formatDateTime } from "@/utils";
import { ChatMessage, MessageContext, NewChatMessage, StoredMessage } from "@/types/message";
import { logInfo } from "@/logger";

export class MessageRepository {
  private messages: StoredMessage[] = [];

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  addMessage(message: NewChatMessage): string;
  addMessage(
    displayText: string,
    processedText: string,
    sender: string,
    context?: MessageContext,
    content?: MessageContent[]
  ): string;
  addMessage(
    messageOrDisplayText: NewChatMessage | string,
    processedText?: string,
    sender?: string,
    context?: MessageContext,
    content?: MessageContent[]
  ): string {
    if (typeof messageOrDisplayText === "object") {
      const message = messageOrDisplayText;
      const id = message.id || this.generateId();
      const timestamp = message.timestamp || formatDateTime(new Date());

      const storedMessage: StoredMessage = {
        id,
        displayText: message.message,
        processedText: message.originalMessage || message.message,
        sender: message.sender,
        timestamp,
        context: message.context,
        contextEnvelope: message.contextEnvelope,
        isVisible: message.isVisible !== false,
        isErrorMessage: message.isErrorMessage,
        sources: message.sources,
        content: message.content,
        responseMetadata: message.responseMetadata,
      };

      this.messages.push(storedMessage);
      logInfo(`[MessageRepository] Added message with ID: ${id}`);
      return id;
    }

    if (processedText === undefined || sender === undefined) {
      throw new Error("processedText and sender are required when using string-based addMessage");
    }

    const displayText = messageOrDisplayText;
    const id = this.generateId();
    const timestamp = formatDateTime(new Date());

    const message: StoredMessage = {
      id,
      displayText,
      processedText,
      sender,
      timestamp,
      context,
      contextEnvelope: undefined,
      isVisible: true,
      isErrorMessage: false,
      content,
    };

    this.messages.push(message);
    logInfo(`[MessageRepository] Added message with ID: ${id}`);

    return id;
  }

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

    message.displayText = newDisplayText;

    if (message.sender === "user" || message.sender === "USER") {
      logInfo(`[MessageRepository] Edited user message ${id}, needs context reprocessing`);
    } else {
      message.processedText = newDisplayText;
      logInfo(`[MessageRepository] Edited AI message ${id}`);
    }

    return true;
  }

  updateProcessedText(
    id: string,
    processedText: string,
    contextEnvelope?: PromptContextEnvelope
  ): boolean {
    const message = this.messages.find((msg) => msg.id === id);
    if (!message) {
      logInfo(`[MessageRepository] Message not found for processed text update: ${id}`);
      return false;
    }

    message.processedText = processedText;
    message.contextEnvelope = contextEnvelope;
    logInfo(`[MessageRepository] Updated processed text for message ${id}`);
    return true;
  }

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

  clear(): void {
    this.messages = [];
    logInfo(`[MessageRepository] Cleared all messages`);
  }

  truncateAfter(index: number): void {
    this.messages = this.messages.slice(0, index + 1);
    logInfo(`[MessageRepository] Truncated messages after index ${index}`);
  }

  truncateAfterMessageId(messageId: string): void {
    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index !== -1) {
      this.messages = this.messages.slice(0, index + 1);
      logInfo(`[MessageRepository] Truncated messages after message ${messageId}`);
    }
  }

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
        contextEnvelope: msg.contextEnvelope,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
        responseMetadata: msg.responseMetadata,
      }));
  }

  getLLMMessage(id: string): ChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return undefined;

    return {
      id: msg.id,
      message: msg.processedText,
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: false,
      context: msg.context,
      contextEnvelope: msg.contextEnvelope,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
      responseMetadata: msg.responseMetadata,
    };
  }

  getLLMMessages(): ChatMessage[] {
    return this.messages.map((msg) => ({
      id: msg.id,
      message: msg.displayText,
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: false,
      context: msg.context,
      contextEnvelope: msg.contextEnvelope,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
    }));
  }

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
      contextEnvelope: msg.contextEnvelope,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
    };
  }

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
        contextEnvelope: msg.contextEnvelope,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
      });
    });
    logInfo(`[MessageRepository] Loaded ${messages.length} messages`);
  }

  getDebugInfo() {
    return {
      totalMessages: this.messages.length,
      visibleMessages: this.messages.filter((m) => m.isVisible).length,
      userMessages: this.messages.filter((m) => m.sender === "user" || m.sender === "USER").length,
      aiMessages: this.messages.filter((m) => m.sender === "AI" || m.sender === "assistant").length,
    };
  }
}
