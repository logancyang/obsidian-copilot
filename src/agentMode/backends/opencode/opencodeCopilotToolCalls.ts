import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import {
  toolInputRecord,
  type CopilotToolCall,
  type CopilotToolUse,
} from "@/agentMode/session/copilotToolCalls";

// Runtime metadata identifies calls made through aliases and dynamic names without guessing from source.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/875
export function readOpencodeCopilotTools(
  _rawInput: unknown,
  rawOutput?: unknown
): CopilotToolUse | null {
  const metadata = toolInputRecord(toolInputRecord(rawOutput).metadata);
  if (!Array.isArray(metadata.toolCalls)) return null;
  const prefix = `${COPILOT_MCP_SERVER_NAME}.`;
  const calls: CopilotToolCall[] = [];
  for (const entry of metadata.toolCalls) {
    const record = toolInputRecord(entry);
    if (typeof record.tool !== "string" || !record.tool.startsWith(prefix)) continue;
    const name = record.tool.slice(prefix.length);
    if (name) calls.push({ name, args: toolInputRecord(record.input) });
  }
  return calls.length > 0 ? { wrapper: "Execute", calls } : null;
}
