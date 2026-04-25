import { logInfo } from "@/logger";
import {
  AgentChatMessage,
  AgentMessagePart,
  NewAgentChatMessage,
} from "@/LLMProviders/agentMode/types";
import { FormattedDateTime, MessageContext } from "@/types/message";
import { formatDateTime } from "@/utils";

/**
 * Internal storage shape for one Agent Mode message. Mirrors `AgentChatMessage`
 * but uses `displayText` internally to keep the streaming append APIs explicit
 * and to leave room for future fields without changing the public type.
 */
interface StoredAgentMessage {
  id: string;
  displayText: string;
  sender: string;
  timestamp: FormattedDateTime;
  isVisible: boolean;
  isErrorMessage?: boolean;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: any[];
}

/**
 * Stable identity for an agent part. Tool calls key on `tool:<toolCallId>` so
 * an `tool_call_update` notification can find and replace the right entry.
 * `plan` parts are singletons per message so they key on the literal `"plan"`.
 * Thoughts have no key — they're folded by `appendAgentThought`.
 */
function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  return undefined;
}

/**
 * Structural equality for agent parts. Lets `upsertAgentPart` skip a
 * notify/re-render when the ACP transport resends a tool-call snapshot whose
 * fields haven't actually changed.
 */
function partsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Single source of truth for one Agent Mode chat session. The UI subscribes
 * via the surrounding `AgentSession`, the session writes streamed updates
 * here, and computed views feed React.
 *
 * Distinct from the legacy `MessageRepository` because Agent Mode messages
 * have structured `parts` (tool calls, thoughts, plans) and Agent Mode has no
 * concept of `processedText` / `contextEnvelope` — ACP owns the model's view
 * of the conversation.
 */
export class AgentMessageStore {
  private messages: StoredAgentMessage[] = [];

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /** Add a message; returns its assigned id. */
  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.generateId();
    const timestamp = message.timestamp || formatDateTime(new Date());
    this.messages.push({
      id,
      displayText: message.message,
      sender: message.sender,
      timestamp,
      context: message.context,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      content: message.content,
      parts: message.parts,
    });
    return id;
  }

  /**
   * Append text to a message body. Used to stream `agent_message_chunk`
   * updates into the placeholder assistant message. Returns false if the
   * target message is missing (the session was likely reset mid-turn).
   */
  appendDisplayText(id: string, chunk: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += chunk;
    return true;
  }

  /**
   * Append text to the trailing `thought` part, creating one if absent. Folds
   * multiple `agent_thought_chunk` updates into a single collapsible block
   * instead of one block per chunk.
   */
  appendAgentThought(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const last = msg.parts[msg.parts.length - 1];
    if (last && last.kind === "thought") {
      last.text += text;
    } else {
      msg.parts.push({ kind: "thought", text });
    }
    return true;
  }

  /**
   * Replace an agent part by its stable identity (see `agentPartId`). Appends
   * if no existing part matches. Returns false when the message is missing OR
   * when the new part is structurally identical to the existing one — callers
   * use this to skip redundant React notifications.
   */
  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const partId = agentPartId(part);
    if (partId !== undefined) {
      const idx = msg.parts.findIndex((p) => agentPartId(p) === partId);
      if (idx !== -1) {
        if (partsEqual(msg.parts[idx], part)) return false;
        msg.parts[idx] = part;
        return true;
      }
    }
    msg.parts.push(part);
    return true;
  }

  /**
   * Mark a message as an error and append the error text to its display body.
   * Used when a turn rejects mid-stream so the partial placeholder gets a
   * visible error instead of looking like a normal truncated reply.
   */
  markMessageError(id: string, errorText: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.isErrorMessage = true;
    const suffix = msg.displayText.length > 0 ? "\n\n" : "";
    msg.displayText += `${suffix}**Error:** ${errorText}`;
    return true;
  }

  deleteMessage(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    return true;
  }

  clear(): void {
    this.messages = [];
  }

  truncateAfterMessageId(messageId: string): void {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      this.messages = this.messages.slice(0, idx + 1);
    }
  }

  /** Visible messages, shaped for the UI. */
  getDisplayMessages(): AgentChatMessage[] {
    return this.messages.filter((m) => m.isVisible).map((m) => this.toAgentChatMessage(m));
  }

  getMessage(id: string): AgentChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    return msg ? this.toAgentChatMessage(msg) : undefined;
  }

  loadMessages(messages: AgentChatMessage[]): void {
    this.clear();
    for (const msg of messages) {
      this.messages.push({
        id: msg.id || this.generateId(),
        displayText: msg.message,
        sender: msg.sender,
        timestamp: msg.timestamp || formatDateTime(new Date()),
        context: msg.context,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        content: msg.content,
        parts: msg.parts,
      });
    }
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
  }

  getDebugInfo() {
    return {
      totalMessages: this.messages.length,
      visibleMessages: this.messages.filter((m) => m.isVisible).length,
    };
  }

  private toAgentChatMessage(m: StoredAgentMessage): AgentChatMessage {
    return {
      id: m.id,
      message: m.displayText,
      sender: m.sender,
      timestamp: m.timestamp,
      isVisible: m.isVisible,
      context: m.context,
      isErrorMessage: m.isErrorMessage,
      content: m.content,
      parts: m.parts,
    };
  }
}
