import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";

export const CHECK_AGENT_TOOL_NAME = "check_agent";
export const ANSWER_AGENT_TOOL_NAME = "answer_agent";
export const STOP_AGENT_TOOL_NAME = "stop_agent";

const TOOL_LINES: Readonly<Record<string, (name: string) => string>> = {
  [ASK_AGENT_TOOL_NAME]: (name) => `Asked ${name}`,
  [CHECK_AGENT_TOOL_NAME]: (name) => `Checked ${name}'s progress`,
  [ANSWER_AGENT_TOOL_NAME]: (name) => `Passed your answer to ${name}`,
  [STOP_AGENT_TOOL_NAME]: (name) => `Stopped ${name}`,
};

export interface AgentToolCall {
  tool: string;
  agent: string;
  message: string | null;
}

function field(part: ToolCallPart, tool: string, name: string): string | null {
  const call = copilotToolCall(part, tool);
  if (!call) return null;
  if ("code" in call) return codeStringField(call.code, name);
  const value = call.args[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function agentToolCall(part: ToolCallPart): AgentToolCall | null {
  // A call that failed did nothing with the agent, so it keeps its ordinary row and error.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  if (part.status === "failed") return null;
  const tool = Object.keys(TOOL_LINES).find((name) => copilotToolCall(part, name));
  const agent = tool ? field(part, tool, "agent") : null;
  if (!tool || !agent) return null;
  return {
    tool,
    agent: agent.replace(/^@/, ""),
    message: tool === ASK_AGENT_TOOL_NAME ? field(part, tool, "message") : null,
  };
}

export function agentToolLineText(call: AgentToolCall, name: string): string {
  return TOOL_LINES[call.tool](name);
}
