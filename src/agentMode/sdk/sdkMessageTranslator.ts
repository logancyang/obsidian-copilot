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
  SessionUsage,
  ToolCallContent,
} from "@/agentMode/session/types";
import { resolveToolName } from "@/agentMode/session/toolName";
import {
  createClaudeTaskPlanState,
  planUpdateFromClaudeToolResult,
  planUpdateFromClaudeToolUse,
  type ClaudeTaskPlanState,
} from "./claudeTodoPlan";
import { deriveToolKind, deriveToolTitle, vendorMetaFields } from "./toolMeta";
import { ClaudeBackgroundTaskStateMachine, type ClaudeTaskToolUpdate } from "./claudeTaskProtocol";

/** Every SDK `system` frame — the `type: "system"` slice of the message union. */
type SDKSystemLike = Extract<SDKMessage, { type: "system" }>;

/**
 * Mutable translator state. One instance lives for a single `query()` call;
 * stream parsing fields reset with each turn, while the Claude task owners are
 * deliberately shared across queries in the same session.
 */
export interface TranslatorState {
  toolUseBlocks: Map<
    number,
    {
      id: string;
      name: string;
      mcpServer?: string;
      inputJsonAcc: string;
      lastParsedInput: unknown;
    }
  >;
  /** Tool-use ids already emitted in this turn — used to dedupe in the assistant-message fallback path. */
  emittedToolUseIds: Set<string>;
  /** Session-lived owner of Claude background-task identity and lifecycle. */
  backgroundTasks: ClaudeBackgroundTaskStateMachine;
  /** Session-lived todo/Task accumulator (see claudeTodoPlan.ts). */
  claudeTasks: ClaudeTaskPlanState;
  /**
   * Occupancy sample from the most recent TOP-LEVEL assistant message this turn
   * (subagent messages excluded). The `result` message's aggregate `usage` sums
   * every API call in the turn — tool loops re-read the whole context from cache
   * each iteration — so it overstates current context; the last main-model
   * response's own per-call usage is the true occupancy. Reset per query.
   */
  lastAssistantUsage?: AssistantUsageSample;
}

/** Per-call token occupancy captured from one assistant message. */
interface AssistantUsageSample {
  usedTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Model that produced this turn — keys into the result's `modelUsage` for the window. */
  model: string;
}

/**
 * Creates query-local parsing state backed by the owning session's Claude task state.
 * @param claudeTasks - The task-plan state to preserve when translator generations share one conversation.
 * @param backgroundTasks - The background-task state to preserve across queries in one session.
 */
export function createTranslatorState(
  claudeTasks?: ClaudeTaskPlanState,
  backgroundTasks?: ClaudeBackgroundTaskStateMachine
): TranslatorState {
  return {
    toolUseBlocks: new Map(),
    emittedToolUseIds: new Set(),
    backgroundTasks: backgroundTasks ?? new ClaudeBackgroundTaskStateMachine(),
    claudeTasks: claudeTasks ?? createClaudeTaskPlanState(),
  };
}

function event(sessionId: SessionId, update: SessionUpdate): SessionEvent {
  return { sessionId, update };
}

/**
 * Preserves the SDK boundary by turning vendor messages into session-domain events for backend-independent consumers.
 * @param msg - The vendor message to translate.
 * @param sessionId - The session that should receive the translated events.
 * @param state - The cross-message correlation state for the active translation stream.
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
    case "system":
      return translateSystemMessage(msg, sessionId, state);
    case "result":
      return translateResultMessage(msg, sessionId, state);
    default:
      return [];
  }
}

/**
 * A `result` closes a turn. Its aggregate `usage` sums every API call in the
 * turn (each tool-loop iteration re-reads the whole context from cache), so it
 * is a cumulative bill, not current context occupancy — dividing it by the
 * window would peg the meter to 100% after a tool-heavy turn even when the live
 * context still fits. We instead report the last top-level assistant message's
 * own per-call usage ({@link TranslatorState.lastAssistantUsage}) as occupancy,
 * paired with THAT model's window from `modelUsage`.
 */
function translateResultMessage(
  msg: SDKResultMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const sample = state.lastAssistantUsage;
  // No main-model turn to measure (e.g. an errored/empty result): leave the
  // meter on its prior occupancy rather than invent a cumulative number.
  if (!sample) return [];

  const sessionUsage: SessionUsage = {
    usedTokens: sample.usedTokens,
    contextWindow: windowForModel(msg.modelUsage, sample.model),
    inputTokens: sample.inputTokens,
    outputTokens: sample.outputTokens,
    cacheReadTokens: sample.cacheReadTokens,
    cacheWriteTokens: sample.cacheWriteTokens,
    updatedAt: Date.now(),
  };
  return [event(sessionId, { sessionUpdate: "usage_update", usage: sessionUsage })];
}

/**
 * The active model's context window — the one that produced the occupancy
 * sample. The result keys `modelUsage` with a context-variant/date suffix (e.g.
 * `claude-opus-4-8[1m]`, `claude-haiku-4-5-20251001`) while the assistant
 * message reports the bare id (`claude-opus-4-8`), so an exact lookup misses on
 * real data — match on prefix too. Falling back to the model that accumulated
 * the most tokens keeps this correct for a bare `<synthetic>` turn and avoids
 * ever taking the max window (a larger-windowed aux/subagent model would
 * otherwise deflate the main conversation's percentage).
 */
function windowForModel(
  modelUsage: SDKResultMessage["modelUsage"],
  sampleModel: string
): number | undefined {
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return undefined;
  if (sampleModel) {
    const exact = modelUsage[sampleModel];
    if (exact) return exact.contextWindow;
    const prefixed = entries.find(([id]) => id.startsWith(sampleModel));
    if (prefixed) return prefixed[1].contextWindow;
  }
  const dominant = entries.reduce((a, b) => (modelTokens(b[1]) > modelTokens(a[1]) ? b : a));
  return dominant[1].contextWindow;
}

function modelTokens(m: SDKResultMessage["modelUsage"][string]): number {
  return m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens;
}

/**
 * Delegates Claude's out-of-order task protocol to the background-task state machine and
 * converts its normalized decision into the session event vocabulary.
 */
function translateSystemMessage(
  msg: SDKSystemLike,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const decision = state.backgroundTasks.accept({ kind: "sdk_message", message: msg });
  return taskUpdateEvents(sessionId, decision.updates);
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
        const { tool: name, mcpServer } = resolveToolName(block.name);
        observeBackgroundTaskLaunch(state, block.id, name, mcpServer);
        state.toolUseBlocks.set(sdkEvent.index, {
          id: block.id,
          name,
          mcpServer,
          inputJsonAcc: "",
          lastParsedInput: block.input ?? {},
        });
        state.emittedToolUseIds.add(block.id);
        const out: SessionEvent[] = [
          event(
            sessionId,
            makeToolCallUpdate(block.id, block.name, block.input ?? {}, parentToolUseId)
          ),
        ];
        // Native plan tool only — an MCP tool sharing the bare name must not
        // flip the UI into plan mode.
        if (!mcpServer && name === "EnterPlanMode") {
          out.push(
            event(sessionId, {
              sessionUpdate: "current_mode_update",
              currentModeId: "plan",
            })
          );
        }
        out.push(
          ...todoPlanEvents(
            sessionId,
            state,
            block.id,
            name,
            mcpServer,
            parentToolUseId,
            block.input ?? {}
          )
        );
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
            ...vendorMetaFields(block.name, parentToolUseId, block.mcpServer),
          }),
          ...todoPlanEvents(
            sessionId,
            state,
            block.id,
            block.name,
            block.mcpServer,
            parentToolUseId,
            parsed.value
          ),
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
          ...vendorMetaFields(block.name, parentToolUseId, block.mcpServer),
        }),
        ...todoPlanEvents(
          sessionId,
          state,
          block.id,
          block.name,
          block.mcpServer,
          parentToolUseId,
          finalInput
        ),
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
  const message = msg.message as {
    content?: unknown;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  const parentToolUseId = msg.parent_tool_use_id ?? undefined;
  // Sample occupancy from the main agent's own response only; a subagent's
  // per-call usage measures a different context and must not drive the meter.
  if (parentToolUseId === undefined && message.usage) {
    state.lastAssistantUsage = assistantUsageSample(message.usage, message.model);
  }
  const content = message.content;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use" || !b.id || !b.name) continue;
    const { tool: name, mcpServer } = resolveToolName(b.name);
    observeBackgroundTaskLaunch(state, b.id, name, mcpServer);
    if (state.emittedToolUseIds.has(b.id)) continue;
    state.emittedToolUseIds.add(b.id);
    out.push(event(sessionId, makeToolCallUpdate(b.id, b.name, b.input ?? {}, parentToolUseId)));
    out.push(
      ...todoPlanEvents(sessionId, state, b.id, name, mcpServer, parentToolUseId, b.input ?? {})
    );
  }
  return out;
}

/**
 * Occupancy for one API call = its full prompt (fresh input + both cache buckets)
 * plus the reply it generated. On a cached turn most input arrives as
 * `cache_read`, so all three input buckets must be summed to recover the prompt
 * size. This is the same formula the SDK result uses — the fix is the *source*:
 * one call's usage (occupancy), not the turn's summed total (cumulative).
 */
function assistantUsageSample(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
  model: string | undefined
): AssistantUsageSample {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    usedTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    model: model ?? "",
  };
}

/**
 * Session todo-list normalization (claudeTodoPlan.ts): feed native, TOP-LEVEL
 * TodoWrite / TaskCreate / TaskUpdate calls into the session accumulator and
 * surface the resulting `plan` update. MCP tools sharing a name and subagent
 * calls (`parent_tool_use_id` set) are excluded — a subagent's todos must not
 * pollute the session-level Progress.
 */
function todoPlanEvents(
  sessionId: SessionId,
  state: TranslatorState,
  toolUseId: string,
  name: string,
  mcpServer: string | undefined,
  parentToolUseId: string | undefined,
  rawInput: unknown
): SessionEvent[] {
  if (mcpServer || parentToolUseId) return [];
  const update = planUpdateFromClaudeToolUse(state.claudeTasks, toolUseId, name, rawInput);
  return update ? [event(sessionId, update)] : [];
}

function translateUserMessage(
  msg: SDKUserMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const decision = state.backgroundTasks.accept({ kind: "sdk_message", message: msg });

  const out: SessionEvent[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type !== "tool_result" || !b.tool_use_id) continue;

    const resultAction = decision.resultActions.get(b.tool_use_id);
    if (resultAction?.kind === "omit") continue;

    let status: AgentToolStatus;
    if (resultAction?.kind === "preserve_status") {
      status = resultAction.status;
    } else {
      status = b.is_error ? "failed" : "completed";
    }
    const outputs = toolResultContent(b.content);
    out.push(
      event(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: b.tool_use_id,
        status,
        content: outputs,
      })
    );
    // A TaskCreate's result carries the task id; only ids pending in the
    // accumulator match, so subagent results are inherently ignored. An
    // is_error result still consumes its pending entry (passed as null content
    // → no plan emitted) so failures can't accumulate over a long session.
    const planUpdate = planUpdateFromClaudeToolResult(
      state.claudeTasks,
      b.tool_use_id,
      b.is_error ? null : b.content
    );
    if (!b.is_error && planUpdate) out.push(event(sessionId, planUpdate));
  }
  out.push(...taskUpdateEvents(sessionId, decision.updates));
  return out;
}

function makeToolCallUpdate(
  toolCallId: string,
  rawName: string,
  rawInput: unknown,
  parentToolUseId?: string
): SessionUpdate {
  const { tool: name, mcpServer } = resolveToolName(rawName);
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: deriveToolTitle(name, rawInput),
    kind: deriveToolKind(name, mcpServer),
    status: "in_progress" as AgentToolStatus,
    rawInput,
    mcpServer,
    ...vendorMetaFields(name, parentToolUseId, mcpServer),
  };
}

function observeBackgroundTaskLaunch(
  state: TranslatorState,
  toolUseId: string,
  name: string,
  mcpServer: string | undefined
): void {
  state.backgroundTasks.accept({
    kind: "tool_snapshot",
    toolCallId: toolUseId,
    nativeToolName: mcpServer ? undefined : name,
  });
}

function taskUpdateEvents(
  sessionId: SessionId,
  updates: readonly ClaudeTaskToolUpdate[]
): SessionEvent[] {
  return updates.map((update) =>
    event(sessionId, { sessionUpdate: "tool_call_update", ...update })
  );
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
