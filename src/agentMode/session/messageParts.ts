import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type {
  AgentMessagePart,
  AgentToolCallOutput,
  CompactionSnapshot,
  PlanSummary,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
} from "@/agentMode/session/types";

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
    progress: call.progress,
  };
}

export function tryReadExitPlanModeCall(args: {
  kind?: string;
  rawInput: unknown;
  isPlanProposal?: boolean;
}): { plan: string; planFilePath?: string } | null {
  const raw = args.rawInput as { plan?: unknown; planFilePath?: unknown } | null | undefined;
  const plan = raw?.plan;
  if (typeof plan !== "string") return null;
  if (!args.isPlanProposal && args.kind !== "switch_mode") return null;
  const planFilePath = typeof raw?.planFilePath === "string" ? raw.planFilePath : undefined;
  return { plan, planFilePath };
}

export function derivePlanTitleFromMarkdown(md: string): string {
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 80);
  }
  return "Plan proposal";
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

export function planToPart(plan: PlanSummary & { sessionUpdate?: "plan" }): AgentMessagePart {
  return {
    kind: "plan",
    entries: plan.entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status,
    })),
  };
}

export function compactionToPart(
  update: CompactionSnapshot,
  startedAtMs: number
): AgentMessagePart {
  return {
    kind: "compaction",
    id: update.id,
    status: update.status,
    trigger: update.trigger,
    error: update.error,
    preTokens: update.preTokens,
    postTokens: update.postTokens,
    startedAtMs,
  };
}

export function findToolCallPart(
  store: AgentMessageStore,
  messageId: string,
  toolCallId: string
): AgentMessagePart | undefined {
  const msg = store.getMessage(messageId);
  return msg?.parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
}

export function upsertCompactionPart(
  store: AgentMessageStore,
  messageId: string,
  update: CompactionSnapshot
): boolean {
  const existing = store
    .getMessage(messageId)
    ?.parts?.find((p) => p.kind === "compaction" && p.id === update.id);
  const startedAtMs = existing?.kind === "compaction" ? existing.startedAtMs : Date.now();
  return store.upsertAgentPart(messageId, compactionToPart(update, startedAtMs));
}
