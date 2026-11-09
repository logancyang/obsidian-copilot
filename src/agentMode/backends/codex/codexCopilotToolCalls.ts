import {
  directCopilotToolUse,
  toolInputRecord,
  type CopilotToolUse,
} from "@/agentMode/session/copilotToolCalls";

// Codex sends a call to an MCP tool with its server and tool name inside the input and its arguments nested under them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export function readCodexCopilotTools(rawInput: unknown): CopilotToolUse | null {
  const input = toolInputRecord(rawInput);
  const tool = typeof input.tool === "string" ? input.tool : undefined;
  const server = typeof input.server === "string" ? input.server : undefined;
  return directCopilotToolUse(server, tool, input.arguments) ?? null;
}
