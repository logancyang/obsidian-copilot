import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { formatDateTime } from "@/utils";
import {
  AgentMessagePart,
  ChatMessage,
  MessageContext,
  NewChatMessage,
  StoredMessage,
} from "@/types/message";
import { logInfo } from "@/logger";

/**
 * Returns the stable identity of an agent part for upsert lookups.
 * Tool calls key on `id` (the ACP toolCallId); other kinds have at most one
 * instance per message and key on their `kind`.
 */
function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  return undefined;
}

/**
 * Structural equality for agent parts. Avoids re-rendering the chat on
 * `tool_call_update` notifications that don't actually change anything (the
 * ACP transport sometimes resends the same tool-call snapshot).
 */
function agentPartsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

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
   * Add a message from a ChatMessage object
   */
  addMessage(message: NewChatMessage): string;
  /**
   * Add a message with separate display and processed text
   */
  addMessage(
    displayText: string,
    processedText: string,
    sender: string,
    context?: MessageContext,
    content?: any[]
  ): string;
  addMessage(
    messageOrDisplayText: NewChatMessage | string,
    processedText?: string,
    sender?: string,
    context?: MessageContext,
    content?: any[]
  ): string {
    // If first parameter is a ChatMessage object
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
        agentParts: message.agentParts,
      };

      this.messages.push(storedMessage);
      logInfo(`[MessageRepository] Added message with ID: ${id}`);
      return id;
    }

    // Otherwise, use string parameters
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
   *
   * TRANSITIONAL METHOD - Updates both processedText (legacy) and contextEnvelope (new)
   * during Phase 1 migration. After ChainRunner migration (Phase 2), this can be
   * simplified to only update contextEnvelope.
   */
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

    // TRANSITIONAL: Update both for backward compatibility
    message.processedText = processedText;
    message.contextEnvelope = contextEnvelope;
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
        contextEnvelope: msg.contextEnvelope,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
        responseMetadata: msg.responseMetadata,
        agentParts: msg.agentParts,
      }));
  }

  /**
   * Get a specific message for LLM processing with full context
   *
   * TRANSITIONAL METHOD - Returns processedText (concatenated context) for
   * legacy ChainRunners that haven't migrated to envelope-based prompts.
   *
   * MIGRATION NOTE:
   * - Phase 1: Use this for current turn processing in legacy runners
   * - Phase 2+: Prefer contextEnvelope with LayerToMessagesConverter
   *
   * Returns processedText (with context) for the message.
   */
  getLLMMessage(id: string): ChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return undefined;

    // Note: agentParts is intentionally omitted from LLM views — Agent Mode
    // never goes through the legacy LangChain path, and we don't want
    // structured parts leaking into prompt construction.
    return {
      id: msg.id,
      message: msg.processedText, // TRANSITIONAL: Full context (legacy format)
      originalMessage: msg.displayText,
      sender: msg.sender,
      timestamp: msg.timestamp,
      isVisible: false, // LLM messages are not for display
      context: msg.context,
      contextEnvelope: msg.contextEnvelope, // NEW: Use this for envelope-based runners
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
      responseMetadata: msg.responseMetadata,
    };
  }

  /**
   * Get all messages for LLM conversation history
   * IMPORTANT: Returns displayText only (raw messages without context)
   * to prevent context duplication in chat memory.
   *
   * Context should be added per-turn via the envelope (L3 layer),
   * not baked into the chat history.
   */
  getLLMMessages(): ChatMessage[] {
    return this.messages.map((msg) => ({
      id: msg.id,
      message: msg.displayText, // Changed from processedText to prevent context duplication
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
      contextEnvelope: msg.contextEnvelope,
      isErrorMessage: msg.isErrorMessage,
      sources: msg.sources,
      content: msg.content,
      agentParts: msg.agentParts,
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
        contextEnvelope: msg.contextEnvelope,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        sources: msg.sources,
        content: msg.content,
        agentParts: msg.agentParts,
      });
    });
    logInfo(`[MessageRepository] Loaded ${messages.length} messages`);
  }

  /**
   * Append text to a message's display body. Used by Agent Mode to stream
   * `agent_message_chunk` updates into the placeholder assistant message.
   */
  appendDisplayText(id: string, chunk: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += chunk;
    msg.processedText = msg.displayText;
    return true;
  }

  /**
   * Replace an entire agent part by its `id`. If no part with that id exists,
   * the part is appended. Returns false when nothing actually changed (so
   * callers can skip notifying React) or when the message is missing.
   */
  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.agentParts) msg.agentParts = [];
    const partId = agentPartId(part);
    if (partId !== undefined) {
      const idx = msg.agentParts.findIndex((p) => agentPartId(p) === partId);
      if (idx !== -1) {
        if (agentPartsEqual(msg.agentParts[idx], part)) return false;
        msg.agentParts[idx] = part;
        return true;
      }
    }
    msg.agentParts.push(part);
    return true;
  }

  /**
   * Mark a message as an error and append the error text to its display
   * body. Used by Agent Mode when a turn rejects mid-stream so the partial
   * placeholder gets a visible error instead of looking like a normal
   * truncated reply.
   */
  markMessageError(id: string, errorText: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.isErrorMessage = true;
    const suffix = msg.displayText.length > 0 ? "\n\n" : "";
    msg.displayText += `${suffix}**Error:** ${errorText}`;
    msg.processedText = msg.displayText;
    return true;
  }

  /**
   * Append text to the trailing `thought` part, creating one if absent.
   * Used to fold multiple `agent_thought_chunk` updates into a single
   * collapsible block instead of one block per chunk.
   */
  appendAgentThought(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.agentParts) msg.agentParts = [];
    const last = msg.agentParts[msg.agentParts.length - 1];
    if (last && last.kind === "thought") {
      last.text += text;
    } else {
      msg.agentParts.push({ kind: "thought", text });
    }
    return true;
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
