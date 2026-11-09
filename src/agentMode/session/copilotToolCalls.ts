import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";

export type CopilotToolCall = { name: string } & (
  | { args: Record<string, unknown> }
  | { code: string }
);

export interface CopilotToolUse {
  wrapper?: string;
  calls: readonly CopilotToolCall[];
}

export function toolInputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function directCopilotToolUse(
  mcpServer: string | undefined,
  toolName: string | undefined,
  input: unknown
): CopilotToolUse | undefined {
  if (mcpServer !== COPILOT_MCP_SERVER_NAME || !toolName) return undefined;
  return { calls: [{ name: toolName, args: toolInputRecord(input) }] };
}
