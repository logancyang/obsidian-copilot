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
  const calls: CopilotToolCall[] = [];
  for (const entry of metadata.toolCalls) {
    const record = toolInputRecord(entry);
    if (typeof record.tool !== "string" || !record.tool) continue;
    // Resource discovery and other tools outside Copilot still need visible names in execute batches.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/875
    const separator = record.tool.indexOf(".");
    const server = separator < 0 ? "opencode" : record.tool.slice(0, separator);
    const name = separator < 0 ? record.tool : record.tool.slice(separator + 1);
    if (!name) continue;
    calls.push({
      name,
      ...(server === COPILOT_MCP_SERVER_NAME ? {} : { server }),
      args: toolInputRecord(record.input),
    });
  }
  return calls.length > 0 ? { wrapper: "Execute", calls } : null;
}
