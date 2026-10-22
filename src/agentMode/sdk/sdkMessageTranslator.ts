import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentToolStatus,
  CompactionStatus,
  CompactionTrigger,
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
import { ClaudeTaskTracker } from "./claudeTaskProtocol";

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
  handbackToolUseIds: Set<string>;
  tasks: ClaudeTaskTracker;
  claudeTasks: ClaudeTaskPlanState;
  lastAssistantUsage?: AssistantUsageSample;
  compactionTrigger: CompactionTrigger;
  openCompaction?: { id: string; trigger: CompactionTrigger };
}

interface AssistantUsageSample {
  usedTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

export function createTranslatorState(claudeTasks?: ClaudeTaskPlanState): TranslatorState {
  return {
    compactionTrigger: "auto",
    toolUseBlocks: new Map(),
    emittedToolUseIds: new Set(),
    handbackToolUseIds: new Set(),
    tasks: new ClaudeTaskTracker(),
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
  return [
    ...compactionEvents(msg, sessionId, state),
    ...state.tasks.accept(msg).map((update) => event(sessionId, update)),
  ];
}

// Claude names no compaction and repeats `compacting` every 30s, so one is open at a time and the
// first status that opens it names it. A reported nothing-to-compact is a failure only in wording.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/635
const NOTHING_TO_COMPACT = /not enough messages to compact/i;
const EMPTY_TOOL_CALL_IDS: ReadonlySet<string> = new Set();

function compactionEvents(
  msg: SDKSystemLike,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  if (msg.subtype === "status" && msg.status === "compacting") {
    state.openCompaction ??= { id: msg.uuid, trigger: state.compactionTrigger };
    return [compactionEvent(sessionId, state.openCompaction, "in_progress")];
  }
  if (msg.subtype === "status" && msg.compact_result === "failed") {
    const nothingToCompact = NOTHING_TO_COMPACT.test(msg.compact_error ?? "");
    return [
      compactionEvent(
        sessionId,
        closeCompaction(state, msg.uuid),
        nothingToCompact ? "skipped" : "failed",
        nothingToCompact ? {} : { error: msg.compact_error }
      ),
    ];
  }
  if (msg.subtype === "compact_boundary") {
    const { trigger, pre_tokens, post_tokens } = msg.compact_metadata;
    // A sample taken before the compaction would restore the full meter at the turn's result.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/635
    state.lastAssistantUsage = undefined;
    return [
      compactionEvent(sessionId, { ...closeCompaction(state, msg.uuid), trigger }, "completed", {
        preTokens: pre_tokens,
        postTokens: post_tokens,
      }),
    ];
  }
  return [];
}

function closeCompaction(
  state: TranslatorState,
  fallbackId: string
): { id: string; trigger: CompactionTrigger } {
  const open = state.openCompaction ?? { id: fallbackId, trigger: state.compactionTrigger };
  state.openCompaction = undefined;
  return open;
}

function compactionEvent(
  sessionId: SessionId,
  compaction: { id: string; trigger: CompactionTrigger },
  status: CompactionStatus,
  details: { error?: string; preTokens?: number; postTokens?: number } = {}
): SessionEvent {
  return event(sessionId, { sessionUpdate: "compaction", ...compaction, status, ...details });
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
          ),
          ...launchEvents(sessionId, state, block.id, block.name, block.input ?? {})
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
        ...(block.mcpServer
          ? []
          : launchEvents(sessionId, state, block.id, block.name, finalInput)),
      ];
    }
    case "message_delta":
    case "message_stop":
    default:
      return [];
  }
}

const SUBAGENT_HANDBACK_TOOL = "SubagentHandback";

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
  // A subagent's turns arrive whole, never as stream deltas, so its text comes from here. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  if (parentToolUseId !== undefined) {
    out.push(...replayAssistantText(content, sessionId));
    out.push(
      ...state.tasks
        .observeSubagentModel(parentToolUseId, message.model)
        .map((update) => event(sessionId, update))
    );
  }
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use" || !b.id || !b.name) continue;
    const launch = launchEvents(sessionId, state, b.id, b.name, b.input);
    if (state.emittedToolUseIds.has(b.id)) {
      out.push(...launch);
      continue;
    }
    state.emittedToolUseIds.add(b.id);
    // A subagent hands its report back through a tool call; the report is its last message. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    if (parentToolUseId !== undefined && b.name === SUBAGENT_HANDBACK_TOOL) {
      state.handbackToolUseIds.add(b.id);
      const report = (b.input as { message?: unknown } | undefined)?.message;
      if (typeof report === "string") out.push(textChunk(sessionId, "agent_message_chunk", report));
      continue;
    }
    const { tool: name, mcpServer } = resolveToolName(b.name);
    out.push(event(sessionId, makeToolCallUpdate(b.id, b.name, b.input ?? {}, parentToolUseId)));
    out.push(
      ...todoPlanEvents(sessionId, state, b.id, name, mcpServer, parentToolUseId, b.input ?? {}),
      ...launch
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

function launchEvents(
  sessionId: SessionId,
  state: TranslatorState,
  toolUseId: string,
  name: string,
  input: unknown
): SessionEvent[] {
  return state.tasks
    .observeToolUse(toolUseId, name, input)
    .map((update) => event(sessionId, update));
}

function translateUserMessage(
  msg: SDKUserMessage,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const originalFiles = preEditContent(msg);
  const results = content.filter(isToolResultBlock);
  const launchAck = state.tasks.launchAcknowledgedBy(
    msg.tool_use_result,
    results.map((b) => b.tool_use_id)
  );
  const stoppedBeforeRun = toolCallsStoppedBeforeRun(msg);

  const out: SessionEvent[] = [];
  for (const b of results) {
    if (state.handbackToolUseIds.has(b.tool_use_id)) continue;
    // A background task's launch result only says it started; the task's end settles its card. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (b.tool_use_id === launchAck) {
      out.push(
        ...state.tasks
          .observeLaunchResult(msg.tool_use_result, toolResultText(b.content))
          .map((update) => event(sessionId, update))
      );
      continue;
    }
    if (state.tasks.isRunningInBackground(b.tool_use_id)) continue;
    const status = toolResultStatus(b, stoppedBeforeRun.has(b.tool_use_id));
    out.push(...toolResultEvents(sessionId, state, b.tool_use_id, b, status, originalFiles));
  }
  return out;
}

interface ToolResultBlock {
  type?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function isToolResultBlock(block: unknown): block is ToolResultBlock & { tool_use_id: string } {
  const b = block as ToolResultBlock | null;
  return b?.type === "tool_result" && !!b.tool_use_id;
}

function toolResultStatus(block: ToolResultBlock, stoppedBeforeRun: boolean): AgentToolStatus {
  if (stoppedBeforeRun) return "cancelled";
  return block.is_error ? "failed" : "completed";
}

// A tool call that a message sent with Send now stopped before it ran is reported as never executed, which is not a failure. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
function toolCallsStoppedBeforeRun(msg: SDKUserMessage): ReadonlySet<string> {
  const meta = (msg as { tool_result_meta?: unknown }).tool_result_meta;
  if (!Array.isArray(meta)) return EMPTY_TOOL_CALL_IDS;
  return new Set(
    meta.flatMap((entry) => {
      const { id, non_execution_kind } = entry as { id?: unknown; non_execution_kind?: unknown };
      return non_execution_kind === "cancelled" && typeof id === "string" ? [id] : [];
    })
  );
}

function toolResultEvents(
  sessionId: SessionId,
  state: TranslatorState,
  toolUseId: string,
  block: ToolResultBlock,
  status: AgentToolStatus,
  originalFiles?: Record<string, string | null>
): SessionEvent[] {
  const out = [
    event(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: toolUseId,
      status,
      content: toolResultContent(block.content),
      ...(originalFiles ? { originalFiles } : {}),
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
// originalFile is the only reliable pre-edit text. The SDK also nulls it for an existing file too
// large to include, so only a Write typed "create" proves the file did not exist.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/347
function preEditContent(msg: SDKUserMessage): Record<string, string | null> | undefined {
  const result = msg.tool_use_result;
  if (typeof result !== "object" || result === null) return undefined;
  if (!("filePath" in result) || typeof result.filePath !== "string") return undefined;
  if (!("originalFile" in result)) return undefined;
  if (typeof result.originalFile === "string") return { [result.filePath]: result.originalFile };
  const created = result.originalFile === null && "type" in result && result.type === "create";
  return created ? { [result.filePath]: null } : undefined;
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

function toolResultText(content: unknown): string {
  return (toolResultContent(content) ?? [])
    .map((c) => (c.type === "content" ? c.content.text : ""))
    .join("\n");
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
  origin?: unknown;
  toolDenialKind?: string;
  message?: { content?: unknown };
  attachment?: {
    type?: string;
    commandMode?: string;
    prompt?: unknown;
    source_uuid?: string;
    isMeta?: boolean;
    origin?: { kind?: string };
  };
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
    if (!entry || entry.isSidechain) continue;
    const occurredAt = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    // Input the CLI adds on its own (a task notification, a subagent's hand-back) is not a message anyone wrote, and the agent's reply to it is a reply of its own. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (entry.type === "user" && isAgentOrigin(entry.origin)) {
      const end = event(sessionId, {
        sessionUpdate: "turn_ended",
        turnId: "",
        stopReason: "end_turn",
      });
      out.push(Number.isFinite(occurredAt) ? { ...end, occurredAt } : end);
      continue;
    }
    // Meta entries are transcript bookkeeping the live chat never showed. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
    if (entry.isMeta) continue;
    // A compaction summary and the echo of a local command such as /compact are Claude CLI bookkeeping, not prompts. https://github.com/Brevilabs/obsidian-copilot-private/issues/635
    if (entry.isCompactSummary || isLocalCommandEcho(entry.message?.content)) continue;
    // The CLI's stand-ins around a stopped turn are not messages anyone wrote. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (isStopBookkeeping(entry.message?.content)) continue;
    const content = entry.message?.content;
    const steer = midTurnPrompt(entry);
    const events = steer
      ? replayUserContent(steer.prompt, steer.messageId, sessionId, state)
      : entry.type === "assistant"
        ? replayAssistantContent(content, sessionId, state)
        : entry.type === "user"
          ? replayUserContent(content, entry.uuid, sessionId, state, entry.toolDenialKind)
          : [];
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

function isAgentOrigin(origin: unknown): boolean {
  return (
    typeof origin === "object" && origin !== null && (origin as { kind?: unknown }).kind !== "human"
  );
}

// A message the user sent while the agent worked is kept as a queued command rather than a user entry. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
function midTurnPrompt(
  entry: ClaudeTranscriptEntry
): { prompt: unknown; messageId?: string } | null {
  const attachment = entry.attachment;
  if (entry.type !== "attachment" || attachment?.type !== "queued_command") return null;
  if (attachment.commandMode !== "prompt" || attachment.isMeta) return null;
  if (attachment.origin && attachment.origin.kind !== "human") return null;
  return { prompt: attachment.prompt, messageId: attachment.source_uuid };
}

function trackUnansweredToolCall(unanswered: Set<string>, update: SessionUpdate): void {
  if (update.sessionUpdate === "tool_call") unanswered.add(update.toolCallId);
  if (
    update.sessionUpdate === "tool_call_update" &&
    (update.status === "completed" || update.status === "failed" || update.status === "cancelled")
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

function replayAssistantText(content: unknown[], sessionId: SessionId): SessionEvent[] {
  return content.flatMap((block) => {
    const b = block as { type?: string; text?: unknown; thinking?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      return [textChunk(sessionId, "agent_message_chunk", b.text)];
    }
    if (b.type === "thinking" && typeof b.thinking === "string") {
      return [textChunk(sessionId, "agent_thought_chunk", b.thinking)];
    }
    return [];
  });
}

function replayAssistantContent(
  content: unknown,
  sessionId: SessionId,
  state: TranslatorState
): SessionEvent[] {
  if (!Array.isArray(content)) return [];
  const out: SessionEvent[] = [];
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use") {
      out.push(...replayAssistantText([block], sessionId));
    } else if (b.id && b.name) {
      const { tool: name, mcpServer } = resolveToolName(b.name);
      const input = b.input ?? {};
      out.push(event(sessionId, makeToolCallUpdate(b.id, b.name, input)));
      out.push(...todoPlanEvents(sessionId, state, b.id, name, mcpServer, undefined, input));
    }
  }
  return out;
}

const LOCAL_COMMAND_ECHO = /^<(command-name|local-command-stdout)>/;

const STOP_BOOKKEEPING = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
  "No response requested.",
]);

function isStopBookkeeping(content: unknown): boolean {
  if (typeof content === "string") return STOP_BOOKKEEPING.has(content.trim());
  if (!Array.isArray(content) || content.length !== 1) return false;
  const block = content[0] as { type?: unknown; text?: unknown };
  return (
    block?.type === "text" &&
    typeof block.text === "string" &&
    STOP_BOOKKEEPING.has(block.text.trim())
  );
}

function isLocalCommandEcho(content: unknown): boolean {
  return typeof content === "string" && LOCAL_COMMAND_ECHO.test(content);
}

function replayUserContent(
  content: unknown,
  messageId: string | undefined,
  sessionId: SessionId,
  state: TranslatorState,
  toolDenialKind?: string
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
      ? toolResultEvents(
          sessionId,
          state,
          b.tool_use_id,
          b,
          toolResultStatus(b, toolDenialKind === "cancelled")
        )
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
