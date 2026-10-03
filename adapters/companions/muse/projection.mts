import { stripCopilotInstructions } from "../instructions";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { parseToolInput } from "./tool-input.mjs";
interface ItemState {
  kind?: string;
  revision: number;
  text: string;
  output: string;
  toolCallId?: string;
}
const MUSE_FAILURE_OUTPUT_LINES = 8;
function workflowUpdate(item: Record<string, any>): Record<string, any> | undefined {
  if (typeof item.workflowRunId !== "string" || !item.workflowRunId) return;
  let summary: unknown;
  const match =
    typeof item.message === "string"
      ? /^<workflow-launch-reconciled>([\s\S]*)<\/workflow-launch-reconciled>$/.exec(
          item.message.trim()
        )
      : null;
  if (match) {
    try {
      summary = JSON.parse(match[1])?.final_summary?.summary;
    } catch {
      summary = undefined;
    }
  }
  if (typeof summary === "string") {
    try {
      summary =
        "````json\n" +
        JSON.stringify(JSON.parse(summary), null, 2).replace(/`/g, "\\u0060") +
        "\n````";
    } catch {
      summary = String(summary);
    }
  }
  const children = Array.isArray(item.children) ? item.children : [];
  return {
    sessionUpdate: "workflow_updated",
    run_id: item.workflowRunId,
    name: item.entryId || item.scriptId || "Workflow",
    revision: item.revision,
    status:
      item.status === "inProgress"
        ? "running"
        : item.status === "completed"
          ? "completed"
          : item.status === "cancelled"
            ? "cancelled"
            : "failed",
    controlsAvailable: false,
    agentProgressDots: true,
    result_summary: typeof summary === "string" ? summary : undefined,
    agents: children
      .filter((child: any) => child && typeof child.childId === "string")
      .map((child: any, i: number) => ({
        agent_id: child.childId,
        label: `Agent ${i + 1}`,
        state:
          child.status === "terminal"
            ? child.terminal || "stopped"
            : child.status === "started" || child.status === "usage"
              ? "active"
              : child.status,
        tokens_used:
          typeof child.usage?.inputTokens === "number" &&
          typeof child.usage?.outputTokens === "number"
            ? child.usage.inputTokens + child.usage.outputTokens
            : undefined,
      })),
  };
}
function museToolFailureMessage(item: Record<string, any>): string {
  const reason = typeof item.failureReason === "string" ? item.failureReason.trim() : "";
  if (reason) return reason;
  const fallback = typeof item.fallbackText === "string" ? item.fallbackText.trim() : "";
  if (fallback) return fallback;
  if (typeof item.visibleOutput === "string") {
    const lines = item.visibleOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length) return lines.slice(-MUSE_FAILURE_OUTPUT_LINES).join("\n");
  }
  const status =
    typeof item.status === "string" && item.status.trim() ? item.status.trim() : "failed";
  return `Muse reported "${status}" without a reason.`;
}
export class Projection {
  private readonly items = new Map<string, ItemState>();
  constructor(
    private readonly emit: (update: SessionUpdate) => void,
    private readonly log: (message: string) => void
  ) {}
  clear(): void {
    this.items.clear();
  }
  private append(state: ItemState, id: string, field: "text" | "output", text: string): void {
    const previous = state[field];
    if (text === previous || previous.startsWith(text)) return;
    if (!text.startsWith(previous)) {
      this.log(`Muse projection: prefix-changing ${field} revision for item ${id}`);
      return;
    }
    const suffix = text.slice(previous.length);
    state[field] = text;
    if (field === "text" && (state.kind === "agentMessage" || state.kind === undefined)) {
      this.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: suffix } });
    } else if (field === "output" && state.kind === "toolCall") {
      this.emit({
        sessionUpdate: "tool_call_update",
        toolCallId: state.toolCallId!,
        content: [{ type: "content", content: { type: "text", text } }],
      });
    }
  }
  acceptHistory(item: Record<string, any>): void {
    if (item.kind === "userMessage" && typeof item.text === "string") {
      this.emit({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: stripCopilotInstructions(item.text) },
      });
    }
    this.accept("item/completed", { item });
  }
  accept(method: string, params: Record<string, any>): void {
    if (method === "session/contextUsage") {
      this.emit({
        sessionUpdate: "usage_update",
        used: params.usedTokens,
        size: params.windowTokens,
      });
      return;
    }
    if (method === "item/delta") {
      const id = params.itemId;
      if (typeof id !== "string" || typeof params.delta !== "string") return;
      let state = this.items.get(id);
      if (!state) {
        state = { revision: -1, text: "", output: "" };
        this.items.set(id, state);
      }
      if (state.kind === "reminderChild") return;
      const field: string = params.field ?? "text";
      if (field === "text" || field === "output")
        this.append(state, id, field, state[field] + params.delta);
      return;
    }
    if (!["item/started", "item/updated", "item/completed"].includes(method)) return;
    const item = params.item;
    if (!item || typeof item.itemId !== "string" || typeof item.revision !== "number") return;
    const id = item.itemId;
    let state = this.items.get(id);
    if (!state) {
      state = { revision: -1, text: "", output: "" };
      this.items.set(id, state);
    }
    if (item.revision <= state.revision) return;
    state.revision = item.revision;
    state.kind = item.kind;
    if (item.kind === "reminderChild") return;
    if (item.kind === "workflow") {
      const workflow = workflowUpdate(item);
      if (workflow)
        this.emit({ sessionUpdate: "session_info_update", _meta: { "muse/workflow": workflow } });
    } else if (item.kind === "toolCall") {
      const first = !state.toolCallId;
      state.toolCallId = item.callId || id;
      const status =
        item.status === "inProgress"
          ? "in_progress"
          : item.status === "completed"
            ? "completed"
            : "failed";
      const printed = typeof item.visibleOutput === "string" ? item.visibleOutput : undefined;
      const visible = status === "completed" ? printed : undefined;
      this.emit({
        sessionUpdate: first ? "tool_call" : "tool_call_update",
        toolCallId: state.toolCallId!,
        title: item.tool || "Muse tool",
        kind: item.tool === "bash" ? "execute" : "other",
        status,
        rawInput: parseToolInput(item.args),
        rawOutput:
          status === "failed"
            ? { message: museToolFailureMessage(item), output: printed ?? "" }
            : visible !== undefined
              ? { output: visible }
              : undefined,
        ...(visible !== undefined
          ? { content: [{ type: "content", content: { type: "text", text: visible } }] }
          : {}),
      });
      if (typeof item.visibleOutput === "string")
        this.append(state, id, "output", item.visibleOutput);
    } else if (item.kind === "agentMessage" && typeof item.text === "string") {
      this.append(state, id, "text", item.text);
    }
  }
}
