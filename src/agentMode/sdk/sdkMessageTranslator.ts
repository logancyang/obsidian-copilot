/** Pure translator: Claude Agent SDK `SDKMessage` → session-domain `SessionUpdate`. */
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentToolStatus,
  SessionEvent,
  SessionId,
  SessionUpdate,
  ToolCallContent,
} from "@/agentMode/session/types";
import { deriveToolKind, deriveToolTitle, vendorMetaFields } from "./toolMeta";

/**
 * Mutable per-query translator state. One instance lives for the duration of
 * a single `query()` call; reset whenever a new turn starts.
 */
export interface TranslatorState {
  toolUseBlocks: Map<
    number,
    {
      id: string;
      name: string;
      inputJsonAcc: string;
      lastParsedInput: unknown;
      emittedToolCall: boolean;
    }
  >;
  /** Tool-use ids already emitted in this turn — used to dedupe in the assistant-message fallback path. */
  emittedToolUseIds: Set<string>;
}

export function createTranslatorState(): TranslatorState {
  return { toolUseBlocks: new Map(), emittedToolUseIds: new Set() };
}

function event(sessionId: SessionId, update: SessionUpdate): SessionEvent {
  return { sessionId, update };
}

/**
 * Translate one SDK message to zero or more session-domain events. Returning
 * an array (rather than firing a callback) keeps the function pure and
 * trivially testable; the caller decides what to do with the events and when
 * to terminate the prompt promise.
 */
export function translateSdkMessage(
  msg: SDKMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  switch (msg.type) {
    case "stream_event":
      return translateStreamEvent(msg, sessionId, state);
    case "assistant":
      return translateAssistantMessage(msg, sessionId, state);
    case "user":
      return translateUserMessage(msg, sessionId, state);
    case "result":
    default:
      return [];
  }
}

export function mapStopReason(msg: SDKResultMessage): "end_turn" | "cancelled" | "refusal" {
  if (msg.subtype === "success") return "end_turn";
  return "cancelled";
}

function translateStreamEvent(
  msg: SDKPartialAssistantMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const parentToolUseId = msg.parent_tool_use_id ?? undefined;
  const sdkEvent = msg.event as
    | { type: "message_start"; message?: unknown }
    | { type: "message_stop" }
    | { type: "message_delta"; delta?: unknown; usage?: unknown }
    | {
        type: "content_block_start";
        index: number;
        content_block:
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
          | { type: "thinking"; thinking: string }
          | { type: "redacted_thinking" };
      }
    | {
        type: "content_block_delta";
        index: number;
        delta:
          | { type: "text_delta"; text: string }
          | { type: "thinking_delta"; thinking: string }
          | { type: "input_json_delta"; partial_json: string }
          | { type: "signature_delta"; signature: string }
          | { type: "citations_delta"; citation: unknown };
      }
    | { type: "content_block_stop"; index: number };

  switch (sdkEvent.type) {
    case "message_start":
      state.toolUseBlocks.clear();
      return [];
    case "content_block_start": {
      const block = sdkEvent.content_block;
      if (block.type === "tool_use") {
        const name = normalizeToolName(block.name);
        state.toolUseBlocks.set(sdkEvent.index, {
          id: block.id,
          name,
          inputJsonAcc: "",
          lastParsedInput: block.input ?? {},
          emittedToolCall: true,
        });
        state.emittedToolUseIds.add(block.id);
        const out: SessionEvent[] = [
          event(sessionId, makeToolCallUpdate(block.id, name, block.input ?? {}, parentToolUseId)),
        ];
        if (name === "EnterPlanMode") {
          out.push(
            event(sessionId, {
              sessionUpdate: "current_mode_update",
              currentModeId: "plan",
            })
          );
        }
        return out;
      }
      return [];
    }
    case "content_block_delta": {
      const delta = sdkEvent.delta;
      if (delta.type === "text_delta") {
        return [
          event(sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: delta.text },
          }),
        ];
      }
      if (delta.type === "thinking_delta") {
        return [
          event(sessionId, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: delta.thinking },
          }),
        ];
      }
      if (delta.type === "input_json_delta") {
        const block = state.toolUseBlocks.get(sdkEvent.index);
        if (!block) return [];
        block.inputJsonAcc += delta.partial_json;
        // Cheap pre-check: a complete JSON value's last non-whitespace byte
        // is `}`, `]`, `"`, a digit, or one of the literals' last letters.
        // Skipping JSON.parse on obviously-incomplete buffers (mid-key,
        // mid-string) avoids O(N) work per delta when a large tool input
        // streams across many small chunks.
        if (!couldBeCompleteJson(block.inputJsonAcc)) return [];
        const parsed = tryParseJson(block.inputJsonAcc);
        if (!parsed.ok) return [];
        block.lastParsedInput = parsed.value;
        return [
          event(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: block.id,
            rawInput: parsed.value,
            ...vendorMetaFields(block.name, parentToolUseId),
          }),
        ];
      }
      return [];
    }
    case "content_block_stop": {
      const block = state.toolUseBlocks.get(sdkEvent.index);
      if (!block) return [];
      const parsed = tryParseJson(block.inputJsonAcc);
      const finalInput = parsed.ok ? parsed.value : block.lastParsedInput;
      block.lastParsedInput = finalInput;
      return [
        event(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: block.id,
          rawInput: finalInput,
          status: "in_progress" as AgentToolStatus,
          ...vendorMetaFields(block.name, parentToolUseId),
        }),
      ];
    }
    case "message_delta":
    case "message_stop":
    default:
      return [];
  }
}

function translateAssistantMessage(
  msg: SDKAssistantMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const out: SessionEvent[] = [];
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return out;
  const parentToolUseId = msg.parent_tool_use_id ?? undefined;
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use" || !b.id || !b.name) continue;
    if (state.emittedToolUseIds.has(b.id)) continue;
    state.emittedToolUseIds.add(b.id);
    out.push(event(sessionId, makeToolCallUpdate(b.id, b.name, b.input ?? {}, parentToolUseId)));
  }
  return out;
}

function translateUserMessage(
  msg: SDKUserMessage,
  sessionId: SessionId,
  _state: TranslatorState
): SessionEvent[] {
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: SessionEvent[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type !== "tool_result" || !b.tool_use_id) continue;
    const status: AgentToolStatus = b.is_error ? "failed" : "completed";
    const outputs = toolResultContent(b.content);
    out.push(
      event(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: b.tool_use_id,
        status,
        content: outputs,
      })
    );
  }
  return out;
}

function makeToolCallUpdate(
  toolCallId: string,
  normalizedName: string,
  rawInput: unknown,
  parentToolUseId?: string
): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: deriveToolTitle(normalizedName, rawInput),
    kind: deriveToolKind(normalizedName),
    status: "in_progress" as AgentToolStatus,
    rawInput,
    ...vendorMetaFields(normalizedName, parentToolUseId),
  };
}

/**
 * Strip the SDK's `mcp__<server>__` prefix on MCP tool names so downstream UI
 * mapping (kind / title / vendorToolName) sees the bare tool name. The
 * non-greedy middle segment tolerates server names containing underscores.
 */
function normalizeToolName(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name);
  return m ? m[1] : name;
}

function toolResultContent(content: unknown): ToolCallContent[] | undefined {
  if (typeof content === "string") {
    return [{ type: "content", content: { type: "text", text: content } }];
  }
  if (!Array.isArray(content)) return undefined;
  const out: ToolCallContent[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      out.push({ type: "content", content: { type: "text", text: b.text } });
    }
  }
  return out.length > 0 ? out : undefined;
}

type ParseResult = { ok: true; value: unknown } | { ok: false };

function tryParseJson(raw: string): ParseResult {
  if (raw.trim().length === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function couldBeCompleteJson(raw: string): boolean {
  let i = raw.length - 1;
  while (i >= 0) {
    const c = raw.charCodeAt(i);
    // Skip ASCII whitespace.
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      i--;
      continue;
    }
    // }, ], ", e (true/false), l (null), or any digit can end a JSON value.
    return (
      c === 0x7d || // }
      c === 0x5d || // ]
      c === 0x22 || // "
      c === 0x65 || // e
      c === 0x6c || // l
      (c >= 0x30 && c <= 0x39) // 0-9
    );
  }
  return false;
}
