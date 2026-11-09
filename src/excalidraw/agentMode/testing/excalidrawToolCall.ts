import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

export function excalidrawToolCall(
  tool: "excalidraw_read" | "excalidraw_render" | "excalidraw_write",
  input: Record<string, unknown> = { path: "Drawings/Release plan.excalidraw.md" },
  overrides: Partial<ToolCallPart> = {}
): ToolCallPart {
  const part: ToolCallPart = {
    kind: "tool_call",
    id: tool,
    title: tool,
    status: "completed",
    toolKind: "other",
    mcpServer: COPILOT_MCP_SERVER_NAME,
    vendorToolName: tool,
    input,
    ...overrides,
  };
  return {
    ...part,
    copilotTools:
      part.copilotTools ?? directCopilotToolUse(part.mcpServer, part.vendorToolName, part.input),
  };
}
