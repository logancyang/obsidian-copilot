import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { MiyoNote } from "@/miyo/agentMode/miyoSearchRun";
import { MIYO_SEARCH_TOOL_NAME } from "@/miyo/miyoSearchTool";

export interface MiyoSearchCallFixture {
  id?: string;
  query?: string;
  notes?: readonly MiyoNote[];
  failureReason?: string;
}

export function miyoSearchCall({
  id = "miyo",
  query = "standing desk",
  notes = [],
  failureReason,
}: MiyoSearchCallFixture = {}): ToolCallPart {
  const failed = failureReason !== undefined;
  const text = failed
    ? `Miyo search failed. Continue with keyword search. Details: ${failureReason}`
    : JSON.stringify({ results: notes, count: notes.length });
  return {
    kind: "tool_call",
    id,
    title: MIYO_SEARCH_TOOL_NAME,
    status: failed ? "failed" : "completed",
    mcpServer: COPILOT_MCP_SERVER_NAME,
    vendorToolName: MIYO_SEARCH_TOOL_NAME,
    input: { query },
    copilotTools: directCopilotToolUse(COPILOT_MCP_SERVER_NAME, MIYO_SEARCH_TOOL_NAME, { query }),
    output: [{ type: "text", text }],
  };
}
