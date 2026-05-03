/**
 * Pure translator: Claude Agent SDK `SDKMessage` → ACP `SessionNotification`.
 * Pure leaf module: no singletons, no I/O, no logger imports.
 */
import type { SessionId, SessionNotification, ToolCallContent } from "@agentclientprotocol/sdk";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { deriveToolKind, deriveToolTitle } from "./toolMeta";

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

function notify(sessionId: SessionId, update: SessionNotification["update"]): SessionNotification {
  return { sessionId, update };
}

/**
 * Translate one SDK message to zero or more ACP notifications. Returning an
 * array (rather than firing a callback) keeps the function pure and trivially
 * testable; the caller decides what to do with the notifications and when to
 * terminate the prompt promise.
 */
export function translateSdkMessage(
  msg: SDKMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionNotification[] {
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
): SessionNotification[] {
  const parentToolUseId = msg.parent_tool_use_id ?? undefined;
  const event = msg.event as
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

  switch (event.type) {
    case "message_start":
      state.toolUseBlocks.clear();
      return [];
    case "content_block_start": {
      const block = event.content_block;
      if (block.type === "tool_use") {
        state.toolUseBlocks.set(event.index, {
          id: block.id,
          name: block.name,
          inputJsonAcc: "",
          lastParsedInput: block.input ?? {},
          emittedToolCall: true,
        });
        state.emittedToolUseIds.add(block.id);
        const out: SessionNotification[] = [
          notify(
            sessionId,
            makeToolCallNotification(block.id, block.name, block.input ?? {}, parentToolUseId)
          ),
        ];
        // EnterPlanMode is auto-approved by the SDK and never reaches
        // canUseTool; synthesize a current_mode_update so the mode badge flips.
        if (block.name === "EnterPlanMode") {
          out.push(
            notify(sessionId, {
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
      const delta = event.delta;
      if (delta.type === "text_delta") {
        return [
          notify(sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: delta.text },
          }),
        ];
      }
      if (delta.type === "thinking_delta") {
        return [
          notify(sessionId, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: delta.thinking },
          }),
        ];
      }
      if (delta.type === "input_json_delta") {
        const block = state.toolUseBlocks.get(event.index);
        if (!block) return [];
        block.inputJsonAcc += delta.partial_json;
        const parsed = tryParseJson(block.inputJsonAcc);
        if (!parsed.ok) return [];
        block.lastParsedInput = parsed.value;
        return [
          notify(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: block.id,
            rawInput: parsed.value,
            _meta: makeMeta(block.name, parentToolUseId),
          }),
        ];
      }
      return [];
    }
    case "content_block_stop": {
      const block = state.toolUseBlocks.get(event.index);
      if (!block) return [];
      const parsed = tryParseJson(block.inputJsonAcc);
      const finalInput = parsed.ok ? parsed.value : block.lastParsedInput;
      block.lastParsedInput = finalInput;
      return [
        notify(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: block.id,
          rawInput: finalInput,
          status: "in_progress",
          _meta: makeMeta(block.name, parentToolUseId),
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
): SessionNotification[] {
  // Fallback when `includePartialMessages: false` — synthesize a tool_call for
  // any tool_use block we haven't already seen via the streaming path.
  const out: SessionNotification[] = [];
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return out;
  const parentToolUseId = msg.parent_tool_use_id ?? undefined;
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use" || !b.id || !b.name) continue;
    if (state.emittedToolUseIds.has(b.id)) continue;
    state.emittedToolUseIds.add(b.id);
    out.push(
      notify(sessionId, makeToolCallNotification(b.id, b.name, b.input ?? {}, parentToolUseId))
    );
  }
  return out;
}

function translateUserMessage(
  msg: SDKUserMessage,
  sessionId: SessionId,
  _state: TranslatorState
): SessionNotification[] {
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: SessionNotification[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type !== "tool_result" || !b.tool_use_id) continue;
    const status = b.is_error ? "failed" : "completed";
    const outputs = toolResultContentToAcp(b.content);
    out.push(
      notify(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: b.tool_use_id,
        status,
        content: outputs,
      })
    );
  }
  return out;
}

function makeToolCallNotification(
  toolCallId: string,
  toolName: string,
  rawInput: unknown,
  parentToolUseId?: string
): SessionNotification["update"] {
  const normalized = normalizeToolName(toolName);
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: deriveToolTitle(normalized, rawInput),
    kind: deriveToolKind(normalized),
    status: "in_progress",
    rawInput,
    _meta: makeMeta(normalized, parentToolUseId),
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

function makeMeta(toolName: string, parentToolUseId?: string): { [key: string]: unknown } {
  const claude: { toolName: string; parentToolUseId?: string } = { toolName };
  if (parentToolUseId) claude.parentToolUseId = parentToolUseId;
  return { claude };
}

function toolResultContentToAcp(content: unknown): ToolCallContent[] | undefined {
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
