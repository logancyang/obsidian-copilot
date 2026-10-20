import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { MIYO_SEARCH_TOOL_NAME } from "@/miyo/miyoSearchTool";

export interface MiyoSearchCallFixture {
  id?: string;
  query?: string;
  notePaths?: readonly string[];
  failureReason?: string;
}

export function miyoSearchCall({
  id = "miyo",
  query = "standing desk",
  notePaths = [],
  failureReason,
}: MiyoSearchCallFixture = {}): ToolCallPart {
  const failed = failureReason !== undefined;
  const text = failed
    ? `Miyo search failed. Continue with keyword search. Details: ${failureReason}`
    : JSON.stringify({ results: notePaths.map((path) => ({ path })), count: notePaths.length });
  return {
    kind: "tool_call",
    id,
    title: MIYO_SEARCH_TOOL_NAME,
    status: failed ? "failed" : "completed",
    mcpServer: COPILOT_MCP_SERVER_NAME,
    vendorToolName: MIYO_SEARCH_TOOL_NAME,
    input: { query },
    output: [{ type: "text", text }],
  };
}
