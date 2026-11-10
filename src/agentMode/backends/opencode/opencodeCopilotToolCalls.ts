import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import { directCopilotToolUse, type CopilotToolUse } from "@/agentMode/session/copilotToolCalls";

export function readOpencodeCopilotTools(
  rawInput: unknown,
  toolName?: string
): CopilotToolUse | null {
  // Direct MCP names retain the server prefix, so feature cards can use the tool's actual arguments.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/875
  const prefix = `${COPILOT_MCP_SERVER_NAME}_`;
  return toolName?.startsWith(prefix)
    ? (directCopilotToolUse(COPILOT_MCP_SERVER_NAME, toolName.slice(prefix.length), rawInput) ??
        null)
    : null;
}
