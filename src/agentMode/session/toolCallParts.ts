import type {
  AgentMessagePart,
  AgentToolCallOutput,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
} from "@/agentMode/session/types";

/**
 * Memory backstop for tool output kept in long-lived React state — NOT a
 * display cap. At ~256KB it sits far above any realistic command/search/file
 * result (the chat renders output collapsed in a scrollable box, so normal and
 * large outputs show in full), and only a runaway multi-hundred-KB blob is
 * trimmed to stop the message store from holding it for the whole session. The
 * agent's own context always receives the full output regardless.
 */
const MAX_TOOL_OUTPUT_TEXT_CHARS = 256_000;

export function toolCallToPart(
  call: ToolCallSnapshot & { sessionUpdate?: "tool_call" }
): AgentMessagePart {
  return {
    kind: "tool_call",
    id: call.toolCallId,
    title: call.title,
    toolKind: call.kind,
    status: call.status ?? "pending",
    input: call.rawInput,
    output: extractToolCallOutputs(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    vendorToolName: call.vendorToolName,
    mcpServer: call.mcpServer,
    parentToolCallId: call.parentToolCallId,
    subagent: call.subagent,
    progress: call.progress,
  };
}

export function mergeToolCallUpdate(
  existing: AgentMessagePart | undefined,
  upd: ToolCallDelta & { sessionUpdate?: "tool_call_update" }
): AgentMessagePart {
  const base: AgentMessagePart =
    existing && existing.kind === "tool_call"
      ? existing
      : {
          kind: "tool_call",
          id: upd.toolCallId,
          title: upd.title ?? "Tool call",
          status: "pending",
        };
  if (base.kind !== "tool_call") return base;
  return {
    ...base,
    title: upd.title ?? base.title,
    toolKind: upd.kind ?? base.toolKind,
    status: upd.status ?? base.status,
    input: upd.rawInput !== undefined ? upd.rawInput : base.input,
    output:
      upd.content !== undefined && upd.content !== null
        ? extractToolCallOutputs(upd.content)
        : base.output,
    locations:
      upd.locations !== undefined && upd.locations !== null
        ? upd.locations.map((l) => ({ path: l.path, line: l.line ?? undefined }))
        : base.locations,
    vendorToolName: upd.vendorToolName ?? base.vendorToolName,
    mcpServer: upd.mcpServer ?? base.mcpServer,
    parentToolCallId: upd.parentToolCallId ?? base.parentToolCallId,
    subagent: upd.subagent ?? base.subagent,
    progress: upd.progress === undefined ? base.progress : { ...base.progress, ...upd.progress },
  };
}

function extractToolCallOutputs(
  content: ToolCallContent[] | null | undefined
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push(capToolOutputText(item.content.text));
    } else if (item.type === "diff") {
      outputs.push({
        type: "diff",
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
      });
    }
  }
  return outputs.length > 0 ? outputs : undefined;
}

/**
 * Pass tool-output text through untouched unless it exceeds the runaway
 * backstop ({@link MAX_TOOL_OUTPUT_TEXT_CHARS}). The marker is explicit that
 * only the *display* copy is trimmed and the agent still got everything, so a
 * user never reads it as lost data.
 */
function capToolOutputText(text: string): AgentToolCallOutput {
  if (text.length <= MAX_TOOL_OUTPUT_TEXT_CHARS) return { type: "text", text };
  const omitted = text.length - MAX_TOOL_OUTPUT_TEXT_CHARS;
  return {
    type: "text",
    text:
      text.slice(0, MAX_TOOL_OUTPUT_TEXT_CHARS) +
      `\n\n[Display trimmed: ${omitted.toLocaleString()} more characters. The agent received the full output.]`,
  };
}
