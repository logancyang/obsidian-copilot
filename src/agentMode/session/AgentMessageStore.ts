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
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  // Live per-agent fan-out state. In-memory only; the persisted body carries the
  // composite that reconstructs it on load.
  fanout?: FanoutTurn;
  // Bumped on every in-place mutation of this message so `getDisplayMessages`
  // can cache the adapted view and only re-adapt when the version moves. The
  // streaming append paths mutate `parts`/`displayText` in place (same array
  // and object references), so a structural diff would miss them — the
  // version counter is the source of truth for "this message changed".
  version: number;
}

const MAX_COMPARE_JSON_CHARS = 8_000;
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

/**
 * Stable identity for an agent part. Tool calls key on `tool:<toolCallId>` so
 * a `tool_call_update` notification can find and replace the right entry.
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
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "text":
      if (b.kind !== "text") return false;
      return a.text === b.text;
    case "thought":
      if (b.kind !== "thought") return false;
      return a.text === b.text;
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
        a.vendorToolName === b.vendorToolName &&
        a.parentToolCallId === b.parentToolCallId &&
        boundedValueEqual(a.input, b.input) &&
        locationsEqual(a.locations, b.locations) &&
        toolOutputsEqual(a.output, b.output)
      );
  }
}

/**
 * Compare plan entries without stringifying the whole part object.
 *
 * Layer 3 of 3 in the todo-plan dedup chain — the RENDER layer: stops an
 * unchanged plan part from re-triggering a React notify on `upsertAgentPart`.
 * The other two layers guard different things and are NOT redundant with this:
 *  1. emit layer (`claudeTodoPlan.emitIfChanged`): collapses the SDK
 *     translator's multiple injection points (stream delta / block stop /
 *     assistant fallback) that observe the same final tool input.
 *  2. snapshot layer (`AgentSession.applyCurrentTodoList`): suppresses
 *     no-op `onCurrentTodoListChanged` ticks for the live Progress section.
 * This layer is the only one that also dedups the plan MESSAGE part.
 */
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

/** Compare tool locations by their scalar fields. */
function locationsEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((loc, index) => loc.path === b[index].path && loc.line === b[index].line);
}

/** Compare rendered tool outputs with bounded string work. */
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

/** Compare arbitrary tool input with bounded stringify work. */
function boundedValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return valueFingerprint(a) === valueFingerprint(b);
}

/** Create a stable, bounded comparison key for arbitrary JSON-like values. */
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

/** Create a bounded comparison key for long text outputs. */
function textFingerprint(text: string): string {
  if (text.length <= MAX_COMPARE_TEXT_EDGE_CHARS * 2) return text;
  return `${text.length}:${text.slice(0, MAX_COMPARE_TEXT_EDGE_CHARS)}:${text.slice(
    -MAX_COMPARE_TEXT_EDGE_CHARS
  )}`;
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
  // Per-message memo of the adapted `AgentChatMessage` plus the `version` it
  // was built from. `getDisplayMessages` reuses the cached object when the
  // version is unchanged, so unchanged messages keep a stable identity across
  // streaming ticks — letting the memoized React message components skip them
  // instead of re-rendering the whole transcript once per streamed token.
  private displayCache = new Map<string, { version: number; view: AgentChatMessage }>();
  // Memo of the last `getDisplayMessages` array so an idle subscription tick
  // (notification with no content change) returns the same reference and the
  // top-level `messages` memo bails out entirely.
  private lastDisplay: AgentChatMessage[] | null = null;

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /** Bump a message's version so its cached adapted view is rebuilt. */
  private touch(msg: StoredAgentMessage): void {
    msg.version += 1;
    this.lastDisplay = null;
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
      turnStopReason: message.turnStopReason,
      turnDurationMs: message.turnDurationMs,
      version: 0,
    });
    this.lastDisplay = null;
    return id;
  }

  /**
   * Stamp a finished turn's `stopReason` and frozen `durationMs` onto its
   * placeholder assistant message. Returns false if the message is missing or
   * already marked complete — the latter lets callers skip notifying.
   */
  markTurnComplete(id: string, stopReason: StopReason, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.turnStopReason !== undefined) return false;
    msg.turnStopReason = stopReason;
    msg.turnDurationMs = durationMs;
    this.touch(msg);
    return true;
  }

  /**
   * Set the live fan-out turn on a message and bump its version so the memoized
   * view invalidates. Stores the live reference; `getDisplayMessages` snapshots
   * it per tick. Returns false when the message is missing.
   */
  setFanout(id: string, turn: FanoutTurn): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.fanout = turn;
    this.touch(msg);
    return true;
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
    this.touch(msg);
    return true;
  }

  /**
   * Append assistant prose to the trailing `text` part, creating one if the
   * last part is a different kind. Mirrors `appendAgentThought` so streamed
   * `agent_message_chunk`s interleave chronologically with tool calls and
   * thoughts inside `parts[]`. Also keeps `displayText` in sync so callers
   * that read the flattened body (persistence, search, error append) stay
   * correct.
   */
  appendAgentText(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += text;
    if (!msg.parts) msg.parts = [];
    const last = msg.parts[msg.parts.length - 1];
    if (last && last.kind === "text") {
      last.text += text;
    } else {
      msg.parts.push({ kind: "text", text });
    }
    this.touch(msg);
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
    this.touch(msg);
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
        this.touch(msg);
        return true;
      }
    }
    msg.parts.push(part);
    this.touch(msg);
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
    this.touch(msg);
    return true;
  }

  /**
   * Whether an assistant placeholder has emitted any user-visible activity.
   * Used to distinguish a legitimate completed turn from a blank backend
   * response that would otherwise render as an empty assistant block.
   */
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

  /**
   * Visible messages, shaped for the UI. Memoized two ways so a fast token
   * stream doesn't rebuild the whole transcript per notification:
   *   - Each adapted message is cached by `version`, so an unchanged message
   *     keeps the SAME object reference across ticks. Downstream React message
   *     components are memoized on that reference and skip re-rendering.
   *   - The returned array is itself cached (`lastDisplay`) and only rebuilt
   *     when a mutation cleared it, so an idle notification returns the exact
   *     same array and the top-level consumer bails out without diffing.
   */
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

  /**
   * Return the adapted view for a stored message, reusing the cached object
   * when its `version` is unchanged so the identity stays stable across
   * streaming ticks.
   */
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
      // Reconstruct the fan-out dropdown from a saved composite body;
      // `parseFanoutComposite` returns null for a plain/old message. The body is
      // kept as-is — only the live `fanout` view is rebuilt.
      const fanout =
        msg.sender === USER_SENDER ? undefined : (parseFanoutComposite(msg.message) ?? undefined);
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
        turnStopReason: msg.turnStopReason,
        turnDurationMs: msg.turnDurationMs,
        fanout,
        version: 0,
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
      turnStopReason: m.turnStopReason,
      turnDurationMs: m.turnDurationMs,
      // Snapshot so each adapted view carries a fresh reference; the orchestrator
      // mutates one turn in place, so the same reference would freeze the dropdown.
      ...(m.fanout ? { fanout: snapshotFanoutTurn(m.fanout) } : {}),
    };
  }
}
