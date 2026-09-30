import { applyTranscriptOp } from "@/agentMode/protocol/applyTranscript";
import type { TranscriptOp } from "@/agentMode/protocol/ops";
import {
  parseFanoutComposite,
  snapshotFanoutTurn,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import {
  AgentChatMessage,
  AgentMessagePart,
  NewAgentChatMessage,
  StopReason,
} from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { MessageContext } from "@/types/message";
import { formatDateTime } from "@/utils";

export interface AgentMessageStoreOptions {
  now?: () => number;
  newId?: () => string;
}

export type AgentTranscriptOp = TranscriptOp<MessageContext>;

const EMPTY_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);

function defaultNewId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function omitUndefined<T extends object>(value: T): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
}

export class AgentMessageStore {
  private messages: readonly AgentChatMessage[] = EMPTY_MESSAGES;
  private visible: { source: readonly AgentChatMessage[]; view: AgentChatMessage[] } | null = null;
  private readonly opListeners = new Set<(op: AgentTranscriptOp) => void>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: AgentMessageStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultNewId;
  }

  onOp(listener: (op: AgentTranscriptOp) => void): () => void {
    this.opListeners.add(listener);
    return () => {
      this.opListeners.delete(listener);
    };
  }

  private commit(op: AgentTranscriptOp): boolean {
    const next = applyTranscriptOp(this.messages, op);
    if (next === this.messages) return false;
    this.messages = next;
    for (const listener of this.opListeners) {
      try {
        listener(op);
      } catch (e) {
        logWarn("[AgentMessageStore] op listener threw", e);
      }
    }
    return true;
  }

  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.newId();
    const stored: AgentChatMessage = omitUndefined({
      id,
      message: message.message,
      sender: message.sender,
      timestamp: message.timestamp || formatDateTime(new Date(this.now())),
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      parts: message.parts,
      context: message.context,
      content: message.content,
      turnStopReason: message.turnStopReason,
      turnDurationMs: message.turnDurationMs,
    });
    this.commit({ t: "msg.add", message: stored });
    return id;
  }

  markTurnComplete(id: string, stopReason: StopReason, durationMs: number): boolean {
    return this.commit({ t: "msg.turnComplete", id, stopReason, durationMs, atMs: this.now() });
  }

  extendTurnDuration(id: string, durationMs: number): boolean {
    return this.commit({ t: "msg.extendDuration", id, durationMs });
  }

  setFanout(id: string, turn: FanoutTurn): boolean {
    return this.commit({ t: "msg.setFanout", id, turn: snapshotFanoutTurn(turn) });
  }

  appendAgentText(id: string, text: string): boolean {
    return this.commit({ t: "msg.appendText", id, text, atMs: this.now() });
  }

  appendAgentThought(id: string, text: string): boolean {
    return this.commit({ t: "msg.appendThought", id, text, atMs: this.now() });
  }

  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    return this.commit({ t: "msg.upsertPart", id, part, atMs: this.now() });
  }

  markMessageError(id: string, errorText: string, durationMs?: number): boolean {
    return this.commit({
      t: "msg.markError",
      id,
      errorText,
      ...(durationMs !== undefined ? { durationMs } : {}),
      atMs: this.now(),
    });
  }

  findMessageIdWithToolCall(toolCallId: string): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.parts?.some((p) => p.kind === "tool_call" && p.id === toolCallId)) return msg.id;
    }
    return undefined;
  }

  hasAssistantActivity(id: string): boolean {
    const msg = this.getMessage(id);
    if (!msg) return false;
    if (msg.message.trim().length > 0) return true;
    return (msg.parts ?? []).some((part) => {
      if (part.kind === "text" || part.kind === "thought") {
        return part.text.trim().length > 0;
      }
      return true;
    });
  }

  getMessages(): readonly AgentChatMessage[] {
    return this.messages;
  }

  getDisplayMessages(): AgentChatMessage[] {
    if (this.visible?.source === this.messages) return this.visible.view;
    const view = this.messages.filter((m) => m.isVisible);
    this.visible = { source: this.messages, view };
    return view;
  }

  getMessage(id: string): AgentChatMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].id === id) return this.messages[i];
    }
    return undefined;
  }

  loadMessages(messages: AgentChatMessage[]): void {
    const loaded = messages.map((msg) => {
      const fanout =
        msg.sender === USER_SENDER ? undefined : (parseFanoutComposite(msg.message) ?? undefined);
      return omitUndefined({
        ...msg,
        id: msg.id || this.newId(),
        isVisible: msg.isVisible !== false,
        fanout,
      });
    });
    this.commit({ t: "transcript.set", messages: loaded });
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
  }

  getDebugInfo() {
    return {
      totalMessages: this.messages.length,
      visibleMessages: this.messages.filter((m) => m.isVisible).length,
    };
  }
}
