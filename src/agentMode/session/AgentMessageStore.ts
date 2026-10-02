import { logInfo } from "@/logger";
import {
  parseFanoutComposite,
  snapshotFanoutTurn,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import {
  AgentChatMessage,
  AgentMessagePart,
  AgentToolCallOutput,
  NewAgentChatMessage,
  StopReason,
} from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { FormattedDateTime, MessageContext } from "@/types/message";
import { formatDateTime } from "@/utils";

interface StoredAgentMessage {
  id: string;
  displayText: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  fanout?: FanoutTurn;
  version: number;
}

const MAX_COMPARE_JSON_CHARS = 8_000;
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  return undefined;
}

function partsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "text":
      if (b.kind !== "text") return false;
      return a.text === b.text;
    case "thought":
      if (b.kind !== "thought") return false;
      return a.text === b.text && a.startedAtMs === b.startedAtMs && a.durationMs === b.durationMs;
    case "plan":
      if (b.kind !== "plan") return false;
      return planEntriesEqual(a.entries, b.entries);
    case "tool_call":
      if (b.kind !== "tool_call") return false;
      return (
        a.id === b.id &&
        a.title === b.title &&
        a.toolKind === b.toolKind &&
        a.status === b.status &&
        a.userResponse === b.userResponse &&
        a.vendorToolName === b.vendorToolName &&
        a.parentToolCallId === b.parentToolCallId &&
        toolProgressEqual(a.progress, b.progress) &&
        boundedValueEqual(a.input, b.input) &&
        locationsEqual(a.locations, b.locations) &&
        toolOutputsEqual(a.output, b.output)
      );
  }
}

function toolProgressEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.description === b.description &&
    a.toolName === b.toolName &&
    a.toolUses === b.toolUses &&
    a.durationMs === b.durationMs &&
    a.totalTokens === b.totalTokens
  );
}

function planEntriesEqual(
  a: Extract<AgentMessagePart, { kind: "plan" }>["entries"],
  b: Extract<AgentMessagePart, { kind: "plan" }>["entries"]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.content === b[index].content &&
      entry.priority === b[index].priority &&
      entry.status === b[index].status
  );
}

function locationsEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((loc, index) => loc.path === b[index].path && loc.line === b[index].line);
}

function toolOutputsEqual(
  a: AgentToolCallOutput[] | undefined,
  b: AgentToolCallOutput[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;

  return a.every((output, index) => {
    const other = b[index];
    if (output.type !== other.type) return false;
    if (output.type === "diff" && other.type === "diff") {
      return (
        output.path === other.path &&
        output.oldText === other.oldText &&
        output.newText === other.newText
      );
    }
    if (output.type === "text" && other.type === "text") {
      return textFingerprint(output.text) === textFingerprint(other.text);
    }
    return false;
  });
}

function boundedValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return valueFingerprint(a) === valueFingerprint(b);
}

function valueFingerprint(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json.length <= MAX_COMPARE_JSON_CHARS) return json;
  return `${json.length}:${json.slice(0, MAX_COMPARE_EDGE_CHARS)}:${json.slice(
    -MAX_COMPARE_EDGE_CHARS
  )}`;
}

function textFingerprint(text: string): string {
  if (text.length <= MAX_COMPARE_TEXT_EDGE_CHARS * 2) return text;
  return `${text.length}:${text.slice(0, MAX_COMPARE_TEXT_EDGE_CHARS)}:${text.slice(
    -MAX_COMPARE_TEXT_EDGE_CHARS
  )}`;
}

export class AgentMessageStore {
  private messages: StoredAgentMessage[] = [];
  private displayCache = new Map<string, { version: number; view: AgentChatMessage }>();
  private lastDisplay: AgentChatMessage[] | null = null;

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private touch(msg: StoredAgentMessage): void {
    msg.version += 1;
    this.lastDisplay = null;
  }

  /**
   * Freeze the latest reasoning block at the event that ended it. React can
   * batch over this transition, so render-time clocks cannot recover it later.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/336
   */
  private finishTrailingThought(msg: StoredAgentMessage): boolean {
    const last = msg.parts?.[msg.parts.length - 1];
    if (
      !last ||
      last.kind !== "thought" ||
      last.startedAtMs === undefined ||
      (last.durationMs !== undefined && msg.turnStopReason === undefined)
    ) {
      return false;
    }
    const durationMs = Math.max(last.durationMs ?? 0, Date.now() - last.startedAtMs);
    if (last.durationMs === durationMs) return false;
    last.durationMs = durationMs;
    return true;
  }

  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.generateId();
    const timestamp =
      message.timestamp === null ? null : message.timestamp || formatDateTime(new Date());
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
      turnStopReason: message.turnStopReason,
      turnDurationMs: message.turnDurationMs,
      version: 0,
    });
    this.lastDisplay = null;
    return id;
  }

  markTurnComplete(id: string, stopReason: StopReason, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.turnStopReason !== undefined) return false;
    this.finishTrailingThought(msg);
    msg.turnStopReason = stopReason;
    msg.turnDurationMs = Math.max(0, durationMs);
    this.touch(msg);
    return true;
  }

  extendTurnDuration(id: string, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.turnDurationMs === undefined) return false;
    const nextDurationMs = Math.max(0, durationMs);
    if (nextDurationMs <= msg.turnDurationMs) return false;
    msg.turnDurationMs = nextDurationMs;
    this.touch(msg);
    return true;
  }

  setFanout(id: string, turn: FanoutTurn): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.fanout = turn;
    this.touch(msg);
    return true;
  }

  appendDisplayText(id: string, chunk: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += chunk;
    this.touch(msg);
    return true;
  }

  setDisplayText(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.displayText === text) return false;
    msg.displayText = text;
    this.touch(msg);
    return true;
  }

  appendAgentText(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += text;
    if (!msg.parts) msg.parts = [];
    this.finishTrailingThought(msg);
    const last = msg.parts[msg.parts.length - 1];
    if (last && last.kind === "text") {
      last.text += text;
    } else {
      msg.parts.push({ kind: "text", text });
    }
    this.touch(msg);
    return true;
  }

  appendAgentThought(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const last = msg.parts[msg.parts.length - 1];
    // A completed message can receive its final thought chunks after the
    // prompt result. Extend a trailing span when possible; otherwise start a
    // frozen span because another event may never arrive to finish it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
    if (
      last &&
      last.kind === "thought" &&
      (last.durationMs === undefined || msg.turnStopReason !== undefined)
    ) {
      last.text += text;
      if (msg.turnStopReason !== undefined && last.startedAtMs !== undefined) {
        last.durationMs = Math.max(0, Date.now() - last.startedAtMs);
      }
    } else {
      const startedAtMs = Date.now();
      msg.parts.push({
        kind: "thought",
        text,
        startedAtMs,
        ...(msg.turnStopReason !== undefined ? { durationMs: 0 } : {}),
      });
    }
    this.touch(msg);
    return true;
  }

  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const partId = agentPartId(part);
    if (partId !== undefined) {
      const idx = msg.parts.findIndex((p) => agentPartId(p) === partId);
      if (idx !== -1) {
        // A fresh plan snapshot can replace its earlier singleton while still
        // ending the reasoning block at the live edge.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
        const finishedThought = part.kind === "plan" && this.finishTrailingThought(msg);
        if (partsEqual(msg.parts[idx], part)) {
          if (finishedThought) this.touch(msg);
          return finishedThought;
        }
        msg.parts[idx] = part;
        this.touch(msg);
        return true;
      }
    }
    this.finishTrailingThought(msg);
    msg.parts.push(part);
    this.touch(msg);
    return true;
  }

  findMessageIdWithToolCall(toolCallId: string): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.parts?.some((p) => p.kind === "tool_call" && p.id === toolCallId)) return msg.id;
    }
    return undefined;
  }

  markMessageError(id: string, errorText: string, durationMs?: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    this.finishTrailingThought(msg);
    msg.isErrorMessage = true;
    if (durationMs !== undefined) msg.turnDurationMs = Math.max(0, durationMs);
    const suffix = msg.displayText.length > 0 ? "\n\n" : "";
    msg.displayText += `${suffix}**Error:** ${errorText}`;
    this.touch(msg);
    return true;
  }

  hasAssistantActivity(id: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.displayText.trim().length > 0) return true;
    return (msg.parts ?? []).some((part) => {
      if (part.kind === "text" || part.kind === "thought") {
        return part.text.trim().length > 0;
      }
      return true;
    });
  }

  deleteMessage(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    this.displayCache.delete(id);
    this.lastDisplay = null;
    return true;
  }

  clear(): void {
    this.messages = [];
    this.displayCache.clear();
    this.lastDisplay = null;
  }

  truncateAfterMessageId(messageId: string): void {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      for (const dropped of this.messages.slice(idx + 1)) {
        this.displayCache.delete(dropped.id);
      }
      this.messages = this.messages.slice(0, idx + 1);
      this.lastDisplay = null;
    }
  }

  getDisplayMessages(): AgentChatMessage[] {
    if (this.lastDisplay !== null) return this.lastDisplay;
    const display = this.messages.filter((m) => m.isVisible).map((m) => this.adaptCached(m));
    this.lastDisplay = display;
    return display;
  }

  getMessage(id: string): AgentChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    return msg ? this.adaptCached(msg) : undefined;
  }

  private adaptCached(m: StoredAgentMessage): AgentChatMessage {
    const cached = this.displayCache.get(m.id);
    if (cached && cached.version === m.version) return cached.view;
    const view = this.toAgentChatMessage(m);
    this.displayCache.set(m.id, { version: m.version, view });
    return view;
  }

  loadMessages(messages: AgentChatMessage[]): void {
    this.clear();
    for (const msg of messages) {
      const fanout =
        msg.sender === USER_SENDER ? undefined : (parseFanoutComposite(msg.message) ?? undefined);
      this.messages.push({
        id: msg.id || this.generateId(),
        displayText: msg.message,
        sender: msg.sender,
        timestamp: msg.timestamp,
        context: msg.context,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        content: msg.content,
        parts: msg.parts,
        turnStopReason: msg.turnStopReason,
        turnDurationMs: msg.turnDurationMs,
        fanout,
        version: 0,
      });
    }
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
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
      turnStopReason: m.turnStopReason,
      turnDurationMs: m.turnDurationMs,
      ...(m.fanout ? { fanout: snapshotFanoutTurn(m.fanout) } : {}),
    };
  }
}
