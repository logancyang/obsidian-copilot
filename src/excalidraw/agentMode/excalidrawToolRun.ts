import type { AgentToolStatus } from "@/agentMode/session/types";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import {
  EXCALIDRAW_READ_TOOL,
  EXCALIDRAW_RENDER_TOOL,
  EXCALIDRAW_TURNED_OFF_TEXT,
  EXCALIDRAW_WRITE_TOOL,
} from "@/excalidraw/excalidrawTools";

export type ExcalidrawToolAction = "create" | "edit" | "read" | "render";
export type ExcalidrawCardAction = Exclude<ExcalidrawToolAction, "render">;

export interface ExcalidrawToolRun {
  action: ExcalidrawToolAction;
  status: AgentToolStatus;
  path: string | null;
}

export interface ExcalidrawDrawingSummary {
  action: ExcalidrawCardAction;
  status: AgentToolStatus;
  path: string | null;
  failed: number;
}

export function excalidrawToolRun(part: ToolCallPart): ExcalidrawToolRun | null {
  const read = copilotToolCall(part, EXCALIDRAW_READ_TOOL.name);
  const write = read ? null : copilotToolCall(part, EXCALIDRAW_WRITE_TOOL.name);
  const call = read ?? write ?? copilotToolCall(part, EXCALIDRAW_RENDER_TOOL.name);
  if (!call) return null;
  // A call made after Excalidraw was turned off completes without drawing anything, so it keeps the ordinary row that
  // shows the tool's explanation. https://github.com/Brevilabs/obsidian-copilot-private/issues/787
  if (part.output?.some((o) => o.type === "text" && o.text.includes(EXCALIDRAW_TURNED_OFF_TEXT))) {
    return null;
  }
  const path =
    "args" in call
      ? typeof call.args.path === "string" && call.args.path.length > 0
        ? call.args.path
        : null
      : codeStringField(call.code, "path");
  const edits =
    "args" in call
      ? call.args.operations !== undefined
      : /[{,]\s*["']?operations["']?\s*[:,}]/.test(call.code);
  const action = read ? "read" : !write ? "render" : edits ? "edit" : "create";
  return { action, status: part.status, path };
}

// A render only checks the agent's work, so it joins a drawing's card but never opens one.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
export function opensDrawingCard(run: ExcalidrawToolRun): boolean {
  return run.action !== "render";
}

const CARD_ACTION_STRENGTH: readonly ExcalidrawCardAction[] = ["create", "edit", "read"];

export function summarizeDrawing(parts: readonly ToolCallPart[]): ExcalidrawDrawingSummary {
  const runs = parts.flatMap((part) => excalidrawToolRun(part) ?? []);
  const touched = runs.filter(opensDrawingCard);
  const status = runs.some((run) => run.status === "pending" || run.status === "in_progress")
    ? "in_progress"
    : touched.some((run) => run.status === "completed")
      ? "completed"
      : touched.some((run) => run.status === "failed")
        ? "failed"
        : "cancelled";
  const named =
    status === "completed" ? touched.filter((run) => run.status === "completed") : touched;
  const action = CARD_ACTION_STRENGTH.find((a) => named.some((run) => run.action === a)) ?? "read";
  return {
    action,
    status,
    path: touched[0]?.path ?? null,
    failed: runs.filter((run) => run.status === "failed").length,
  };
}
