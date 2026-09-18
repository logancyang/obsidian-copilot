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

type SDKSystemLike = Extract<SDKMessage, { type: "system" }>;

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
  emittedToolUseIds: Set<string>;
  backgroundTasks: ClaudeBackgroundTaskStateMachine;
  claudeTasks: ClaudeTaskPlanState;
  lastAssistantUsage?: AssistantUsageSample;
}

interface AssistantUsageSample {
  usedTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

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

function translateResultMessage(
  msg: SDKResultMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const sample = state.lastAssistantUsage;
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
  const rawOutput = preEditContent(msg);

  const out: SessionEvent[] = [];
  for (const block of content) {
    const b = block as ToolResultBlock;
    if (b.type !== "tool_result" || !b.tool_use_id) continue;

    const resultAction = decision.resultActions.get(b.tool_use_id);
    if (resultAction?.kind === "omit") continue;

    const status =
      resultAction?.kind === "preserve_status" ? resultAction.status : toolResultStatus(b);
    out.push(...toolResultEvents(sessionId, state, b.tool_use_id, b, status, rawOutput));
  }
  out.push(...taskUpdateEvents(sessionId, decision.updates));
  return out;
}

interface ToolResultBlock {
  type?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function toolResultStatus(block: ToolResultBlock): AgentToolStatus {
  return block.is_error ? "failed" : "completed";
}

function toolResultEvents(
  sessionId: SessionId,
  state: TranslatorState,
  toolUseId: string,
  block: ToolResultBlock,
  status: AgentToolStatus,
  rawOutput?: { originalFile: string }
): SessionEvent[] {
  const out = [
    event(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: toolUseId,
      status,
      content: toolResultContent(block.content),
      ...(rawOutput ? { rawOutput } : {}),
    }),
  ];
  const planUpdate = planUpdateFromClaudeToolResult(
    state.claudeTasks,
    toolUseId,
    block.is_error ? null : block.content
  );
  if (!block.is_error && planUpdate) out.push(event(sessionId, planUpdate));
  return out;
}

// The in-process backend can read the vault after the write lands; the SDK's reported
// originalFile is the only reliable pre-edit text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/347
function preEditContent(msg: SDKUserMessage): { originalFile: string } | undefined {
  const result = (msg as { tool_use_result?: unknown }).tool_use_result;
  if (typeof result !== "object" || result === null) return undefined;
  const originalFile = (result as { originalFile?: unknown }).originalFile;
  return typeof originalFile === "string" ? { originalFile } : undefined;
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
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      i--;
      continue;
    }
    return (
      c === 0x7d || c === 0x5d || c === 0x22 || c === 0x65 || c === 0x6c || (c >= 0x30 && c <= 0x39)
    );
  }
  return false;
}

interface ClaudeTranscriptEntry {
  type?: string;
  uuid?: string;
  timestamp?: unknown;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
}

export function replayClaudeTranscript(
  jsonl: string,
  sessionId: SessionId,
  claudeTasks: ClaudeTaskPlanState
): SessionEvent[] {
  const state = createTranslatorState(claudeTasks);
  const out: SessionEvent[] = [];
  const unansweredToolCallIds = new Set<string>();
  for (const line of jsonl.split(/\r?\n/)) {
    const entry = parseTranscriptEntry(line);
    // Meta, subagent, and compaction entries are transcript bookkeeping the live chat never showed. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
    if (!entry || entry.isMeta || entry.isSidechain || entry.isCompactSummary) continue;
    const content = entry.message?.content;
    const events =
      entry.type === "assistant"
        ? replayAssistantContent(content, sessionId, state)
        : entry.type === "user"
          ? replayUserContent(content, entry.uuid, sessionId, state)
          : [];
    const occurredAt = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    for (const e of events) {
      trackUnansweredToolCall(unansweredToolCallIds, e.update);
      out.push(Number.isFinite(occurredAt) ? { ...e, occurredAt } : e);
    }
  }
  // A tool call the transcript never answered was cut off with its turn, and nothing will settle it after the replay. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
  for (const toolCallId of unansweredToolCallIds) {
    out.push(event(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "failed" }));
  }
  return out;
}

function trackUnansweredToolCall(unanswered: Set<string>, update: SessionUpdate): void {
  if (update.sessionUpdate === "tool_call") unanswered.add(update.toolCallId);
  if (
    update.sessionUpdate === "tool_call_update" &&
    (update.status === "completed" || update.status === "failed")
  ) {
    unanswered.delete(update.toolCallId);
  }
}

function parseTranscriptEntry(line: string): ClaudeTranscriptEntry | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as ClaudeTranscriptEntry;
  } catch {
    return null;
  }
}

function replayAssistantContent(
  content: unknown,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  if (!Array.isArray(content)) return [];
  const out: SessionEvent[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      text?: unknown;
      thinking?: unknown;
      id?: string;
      name?: string;
      input?: unknown;
    };
    if (b.type === "text" && typeof b.text === "string") {
      out.push(textChunk(sessionId, "agent_message_chunk", b.text));
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      out.push(textChunk(sessionId, "agent_thought_chunk", b.thinking));
    } else if (b.type === "tool_use" && b.id && b.name) {
      const { tool: name, mcpServer } = resolveToolName(b.name);
      const input = b.input ?? {};
      out.push(event(sessionId, makeToolCallUpdate(b.id, b.name, input)));
      out.push(...todoPlanEvents(sessionId, state, b.id, name, mcpServer, undefined, input));
    }
  }
  return out;
}

function replayUserContent(
  content: unknown,
  messageId: string | undefined,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  if (typeof content === "string") {
    return [textChunk(sessionId, "user_message_chunk", content, messageId)];
  }
  if (!Array.isArray(content)) return [];
  const blocks = content as (ToolResultBlock & { text?: unknown })[];
  if (!blocks.some((b) => b?.type === "tool_result")) {
    const text = blocks
      .flatMap((b) => (b?.type === "text" && typeof b.text === "string" ? [b.text] : []))
      .join("\n\n");
    return text ? [textChunk(sessionId, "user_message_chunk", text, messageId)] : [];
  }
  // A replayed background task has no later notification to settle it, so its result alone sets the status. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
  return blocks.flatMap((b) =>
    b?.type === "tool_result" && b.tool_use_id
      ? toolResultEvents(sessionId, state, b.tool_use_id, b, toolResultStatus(b))
      : []
  );
}

function textChunk(
  sessionId: SessionId,
  sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  text: string,
  messageId?: string
): SessionEvent {
  return event(sessionId, {
    sessionUpdate,
    content: { type: "text", text },
    ...(messageId === undefined ? {} : { messageId }),
  });
}
