import type { AgentToolStatus } from "@/agentMode/session/types";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import { EXCALIDRAW_READ_TOOL, EXCALIDRAW_WRITE_TOOL } from "@/excalidraw/excalidrawTools";

export type ExcalidrawToolAction = "create" | "edit" | "read";

export interface ExcalidrawToolRun {
  action: ExcalidrawToolAction;
  status: Exclude<AgentToolStatus, "failed">;
  path: string | null;
}

export function excalidrawToolRun(part: ToolCallPart): ExcalidrawToolRun | null {
  // Agents retry a failed write, so a card per failure would crowd the trail; the failure stays an
  // ordinary row in the activity group and the drawing gets its card once a write goes through.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
  if (part.status === "failed") return null;
  const read = copilotToolCall(part, EXCALIDRAW_READ_TOOL.name);
  const call = read ?? copilotToolCall(part, EXCALIDRAW_WRITE_TOOL.name);
  if (!call) return null;
  const path =
    "args" in call
      ? typeof call.args.path === "string" && call.args.path.length > 0
        ? call.args.path
        : null
      : codeStringField(call.code, "path");
  const edits =
    "args" in call ? call.args.operations !== undefined : /\boperations\b/.test(call.code);
  return { action: read ? "read" : edits ? "edit" : "create", status: part.status, path };
}
