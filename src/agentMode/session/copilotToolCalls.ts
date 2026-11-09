import type { AgentMessagePart } from "@/agentMode/session/types";

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

export type CopilotToolCall = { args: Record<string, unknown> } | { code: string };

export interface CopilotToolCallReader {
  call(part: ToolCallPart, toolName: string): CopilotToolCall | null;
  toolName(part: ToolCallPart): string | null;
}

export function toolInputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
