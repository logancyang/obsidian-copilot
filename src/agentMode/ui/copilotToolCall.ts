import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { CopilotToolCall } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

export function copilotToolCall(part: ToolCallPart, toolName: string): CopilotToolCall | null {
  // Identically named tools on another server must not render as Copilot feature cards.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/875
  return (
    part.copilotTools?.calls.find(
      (call) =>
        call.name === toolName &&
        (call.server ?? COPILOT_MCP_SERVER_NAME) === COPILOT_MCP_SERVER_NAME
    ) ?? null
  );
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
