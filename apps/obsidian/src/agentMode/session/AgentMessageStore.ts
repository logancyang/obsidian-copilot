import type { AgentMention } from "@/agents/agentMentions";
import type { MemorySave } from "@/agents/memorySaves";
import { logInfo } from "@/logger";
import type {
  AgentChatMessage,
  AgentMessagePart,
  NewAgentChatMessage,
  StopReason,
  TurnFileChange,
} from "@/agentMode/session/types";
import { isCompactCommand } from "@/commands/compactCommand";
import { USER_SENDER } from "@/constants";
import type { FormattedDateTime } from "@/types/message";
import { formatDateTime } from "@/utils";
import { CHAT_IMAGE_EMBED } from "@/utils/chatImagePersistence";
import {
  applyTranscriptOp,
  type SavedMessageFields,
  type TranscriptOp,
} from "@copilot/protocol/transcript";

export type AgentTranscriptOp = TranscriptOp<AgentChatMessage>;

export interface TranscriptSources {
  now(): number;
  newMessageId(): string;
}

const NO_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);
const NOTHING_RESTORED: Pick<AgentChatMessage, "toolsUsed" | "memorySaves" | "agentMentions"> =
  Object.freeze({});

function storedMessage(
  id: string,
  timestamp: FormattedDateTime | null,
  source: NewAgentChatMessage,
  restored: Pick<AgentChatMessage, "toolsUsed" | "memorySaves" | "agentMentions">
): AgentChatMessage {
  return {
    id,
    message: source.message,
    sender: source.sender,
    timestamp,
    isVisible: source.isVisible !== false,
    context: source.context,
    isErrorMessage: source.isErrorMessage,
    content: source.content,
    parts: source.parts,
    turnStopReason: source.turnStopReason,
    agentCancelCause: undefined,
    turnDurationMs: source.turnDurationMs,
    fileChanges: undefined,
    toolsUsed: restored.toolsUsed,
    memorySaves: restored.memorySaves,
    agentMentions: restored.agentMentions,
  };
}

export class AgentMessageStore {
  private messages = NO_MESSAGES;
  private display: { source: readonly AgentChatMessage[]; visible: AgentChatMessage[] } | null =
    null;
  private readonly permissionDeclinedIds = new Set<string>();
  private readonly opListeners = new Set<(op: AgentTranscriptOp) => void>();

  constructor(private readonly sources: TranscriptSources) {}

  subscribeToOps(listener: (op: AgentTranscriptOp) => void): () => void {
    this.opListeners.add(listener);
    return () => this.opListeners.delete(listener);
  }

  private commit(op: AgentTranscriptOp): boolean {
    const next = applyTranscriptOp(this.messages, op);
    if (next === this.messages) return false;
    this.messages = next;
    for (const listener of this.opListeners) listener(op);
    return true;
  }

  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.sources.newMessageId();
    const timestamp =
      message.timestamp === null
        ? null
        : message.timestamp || formatDateTime(new Date(this.sources.now()));
    this.commit({ type: "add", message: storedMessage(id, timestamp, message, NOTHING_RESTORED) });
    return id;
  }

  markTurnComplete(id: string, stopReason: StopReason, durationMs: number): boolean {
    return this.commit({
      type: "completeTurn",
      id,
      stopReason,
      durationMs,
      atMs: this.sources.now(),
    });
  }

  markPermissionDeclined(id: string): void {
    if (this.getMessage(id)) this.permissionDeclinedIds.add(id);
  }

  markCancelledByAgent(id: string): void {
    this.commit({
      type: "setCancelCause",
      id,
      cause: this.permissionDeclinedIds.has(id) ? "permission_declined" : "unspecified",
    });
  }

  extendTurnDuration(id: string, durationMs: number): boolean {
    return this.commit({ type: "extendTurnDuration", id, durationMs });
  }

  // A replay has its own times, no pasted images or attached context, and its own tool wording, and autosave rewrites the note from these messages, so each one the note lines up with takes the note's time, image embeds, attached context and tools-used list.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/921
  adoptNoteRows(saved: readonly AgentChatMessage[]): void {
    const visible = this.messages.filter((m) => m.isVisible);
    const rows: { id: string; fields: SavedMessageFields<AgentChatMessage> }[] = [];
    let next = 0;
    for (const row of saved) {
      // Claude's replay drops a /compact turn, which the note keeps.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/635
      if (row.sender === USER_SENDER && isCompactCommand(row.message)) continue;
      const msg = visible[next];
      if (!msg) break;
      if (msg.sender !== row.sender) {
        // A reply only the note has, such as a failed turn's error, is skipped so the rows after it keep their saved rules, @ runs and times.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/942
        if (row.sender !== USER_SENDER) continue;
        break;
      }
      const isUser = msg.sender === USER_SENDER;
      // A note can hold a turn the agent never got (a multi-agent turn, a refused message) while the replay holds one sent after the last save, so a user message pairs only with the note's message of the same text and never takes another message's images.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/921
      if (isUser && row.message.replace(CHAT_IMAGE_EMBED, "").trim() !== msg.message.trim()) {
        break;
      }
      next += 1;
      rows.push({
        id: msg.id,
        fields: {
          ...(row.timestamp ? { timestamp: row.timestamp } : {}),
          ...(isUser ? { message: row.message } : {}),
          ...(row.context ? { context: row.context } : {}),
          ...(row.toolsUsed ? { toolsUsed: row.toolsUsed } : {}),
          ...(row.memorySaves ? { memorySaves: row.memorySaves } : {}),
          ...(row.agentMentions ? { agentMentions: row.agentMentions } : {}),
        },
      });
    }
    this.commit({ type: "restoreSavedFields", rows });
  }

  setFileChanges(
    id: string,
    changes: TurnFileChange[],
    memorySaves: readonly MemorySave[] = []
  ): boolean {
    if (!this.commit({ type: "setFileChanges", id, changes })) return false;
    if (memorySaves.length > 0) this.commit({ type: "patchExtension", id, patch: { memorySaves } });
    return true;
  }

  setAgentMentions(id: string, mentions: readonly AgentMention[]): boolean {
    return this.commit({ type: "patchExtension", id, patch: { agentMentions: mentions } });
  }

  appendAgentText(id: string, text: string): boolean {
    return this.commit({ type: "appendText", id, text, atMs: this.sources.now() });
  }

  appendAgentThought(id: string, text: string): boolean {
    return this.commit({ type: "appendThought", id, text, atMs: this.sources.now() });
  }

  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    return this.commit({ type: "upsertPart", id, part, atMs: this.sources.now() });
  }

  settleOpenParts(id: string, status: "cancelled" | "failed" = "cancelled"): boolean {
    return this.commit({ type: "settleOpenParts", id, status });
  }

  stopToolCalls(id: string, keepToolCallIds: ReadonlySet<string>): boolean {
    return this.commit({ type: "stopToolCalls", id, keepToolCallIds: [...keepToolCallIds] });
  }

  findMessageIdWithToolCall(toolCallId: string): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.parts?.some((p) => p.kind === "tool_call" && p.id === toolCallId)) return msg.id;
    }
    return undefined;
  }

  markMessageError(id: string, errorText: string, durationMs?: number): boolean {
    return this.commit({ type: "markError", id, errorText, durationMs, atMs: this.sources.now() });
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

  deleteMessage(id: string): boolean {
    this.permissionDeclinedIds.delete(id);
    return this.commit({ type: "remove", id });
  }

  clear(): void {
    this.replaceAll(NO_MESSAGES);
  }

  getDisplayMessages(): AgentChatMessage[] {
    if (this.display?.source !== this.messages) {
      this.display = { source: this.messages, visible: this.messages.filter((m) => m.isVisible) };
    }
    return this.display.visible;
  }

  getMessage(id: string): AgentChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  loadMessages(messages: AgentChatMessage[]): void {
    this.replaceAll(
      messages.map((msg) =>
        storedMessage(msg.id || this.sources.newMessageId(), msg.timestamp, msg, msg)
      )
    );
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
  }

  private replaceAll(messages: readonly AgentChatMessage[]): void {
    this.permissionDeclinedIds.clear();
    this.commit({ type: "replaceAll", messages });
  }
}
