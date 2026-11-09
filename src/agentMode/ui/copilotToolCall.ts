import { createContext, useContext } from "react";
import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import {
  toolInputRecord,
  type CopilotToolCall,
  type CopilotToolCallReader,
} from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

export type { CopilotToolCall, CopilotToolCallReader };

export const NO_COPILOT_TOOL_CALLS: CopilotToolCallReader = Object.freeze({
  call: () => null,
  toolName: () => null,
});

const CopilotToolCallsContext = createContext<CopilotToolCallReader>(NO_COPILOT_TOOL_CALLS);

export const CopilotToolCallsProvider = CopilotToolCallsContext.Provider;

export function useCopilotToolCalls(): CopilotToolCallReader {
  return useContext(CopilotToolCallsContext);
}

export function copilotToolCall(
  part: ToolCallPart,
  toolName: string,
  reader: CopilotToolCallReader
): CopilotToolCall | null {
  if (part.mcpServer === COPILOT_MCP_SERVER_NAME) {
    return part.vendorToolName === toolName ? { args: toolInputRecord(part.input) } : null;
  }
  return reader.call(part, toolName);
}

export function copilotToolName(part: ToolCallPart, reader: CopilotToolCallReader): string | null {
  if (part.mcpServer === COPILOT_MCP_SERVER_NAME) return part.vendorToolName ?? null;
  return reader.toolName(part);
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
