import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import { toolInputRecord, type CopilotToolCallReader } from "@/agentMode/session/copilotToolCalls";

// Codex sends a call to an MCP tool with its server and tool name inside the input and its arguments nested under them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export const codexCopilotToolCalls: CopilotToolCallReader = {
  call(part, toolName) {
    const input = toolInputRecord(part.input);
    return input.server === COPILOT_MCP_SERVER_NAME && input.tool === toolName
      ? { args: toolInputRecord(input.arguments) }
      : null;
  },
  toolName(part) {
    const input = toolInputRecord(part.input);
    return input.server === COPILOT_MCP_SERVER_NAME && typeof input.tool === "string"
      ? input.tool
      : null;
  },
};
