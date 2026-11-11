import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import {
  directCopilotToolUse,
  toolInputRecord,
  type CopilotToolUse,
} from "@/agentMode/session/copilotToolCalls";

const ANTIGRAVITY_COPILOT_TOOL_PREFIX = `mcp_${COPILOT_MCP_SERVER_NAME}_`;

function antigravityToolName(title: string | undefined): string | undefined {
  return title?.split(" ").find((word) => word.startsWith(ANTIGRAVITY_COPILOT_TOOL_PREFIX));
}

export function readAntigravityCopilotTools(
  rawInput: unknown,
  title?: string
): CopilotToolUse | null {
  const toolName = antigravityToolName(title)?.slice(ANTIGRAVITY_COPILOT_TOOL_PREFIX.length);
  const args = { ...toolInputRecord(rawInput) };
  delete args.toolSummary;
  return directCopilotToolUse(COPILOT_MCP_SERVER_NAME, toolName, args) ?? null;
}
