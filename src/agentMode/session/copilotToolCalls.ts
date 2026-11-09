import { describeConnectorTool } from "@/connectors/connectorTools";
import { humanizeToolName, serviceToolName } from "@/lib/toolName";
import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";

export type CopilotToolCall = { name: string } & (
  | { args: Record<string, unknown> }
  | { code: string }
);

export interface CopilotToolUse {
  wrapper?: string;
  label?: string;
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

export function copilotToolNameLabel(name: string): string {
  const tool = describeConnectorTool(name);
  return tool
    ? `${tool.serviceName} · ${serviceToolName(tool.serviceName, tool.toolName)}`
    : `${COPILOT_MCP_SERVER_NAME} · ${humanizeToolName(name)}`;
}

export function toolUseLabel(use: CopilotToolUse | undefined): string | null {
  // Saved chats from before display labels were normalized still carry canonical Copilot calls.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/875
  const label =
    use?.label ?? [...new Set(use?.calls.map(({ name }) => copilotToolNameLabel(name)))].join(", ");
  if (!label) return null;
  return use?.wrapper ? `${use.wrapper} · ${label}` : label;
}
