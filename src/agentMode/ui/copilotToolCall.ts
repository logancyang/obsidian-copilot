import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

export type CopilotToolCall = { args: Record<string, unknown> } | { code: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// Claude names the call by server and tool, Codex nests the arguments under `server`/`tool`, and
// OpenCode runs it as JavaScript inside its `execute` tool, so its arguments are only code.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export function copilotToolCall(part: ToolCallPart, toolName: string): CopilotToolCall | null {
  const input = asRecord(part.input);
  if (part.mcpServer === COPILOT_MCP_SERVER_NAME && part.vendorToolName === toolName) {
    return { args: input };
  }
  if (input.server === COPILOT_MCP_SERVER_NAME && input.tool === toolName) {
    return { args: asRecord(input.arguments) };
  }
  const code = typeof input.code === "string" ? input.code : "";
  const call = new RegExp(`tools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\]\\.${toolName}\\(`).exec(
    code
  );
  return call ? { code: code.slice(call.index) } : null;
}

export function codeStringField(code: string, field: string): string | null {
  const literal = new RegExp(
    `\\b${field}["']?:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`
  ).exec(code);
  if (!literal) return null;
  // Generated JavaScript often single-quotes a string, which JSON cannot parse until its quotes are swapped.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/735
  const body = literal[1] ?? literal[2].replace(/\\'/g, "'").replace(/\\?"/g, '\\"');
  try {
    const value: unknown = JSON.parse(`"${body}"`);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
