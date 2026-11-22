import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";

export const CHECK_AGENT_TOOL_NAME = "check_teammate";
export const ANSWER_AGENT_TOOL_NAME = "answer_teammate";
export const STOP_AGENT_TOOL_NAME = "stop_teammate";

const TOOL_LINES: Readonly<Record<string, (name: string) => string>> = {
  [CHECK_AGENT_TOOL_NAME]: (name) => `Checked ${name}'s progress`,
  [ANSWER_AGENT_TOOL_NAME]: (name) => `Passed your answer to ${name}`,
  [STOP_AGENT_TOOL_NAME]: (name) => `Stopped ${name}`,
};

const AGENT_TOOLS = [ASK_AGENT_TOOL_NAME, ...Object.keys(TOOL_LINES)];

export interface AgentToolCall {
  tool: string;
  agent: string | null;
}

function agentField(part: ToolCallPart, tool: string): string | null {
  const call = copilotToolCall(part, tool);
  if (!call) return null;
  if ("code" in call) return codeStringField(call.code, "teammate");
  const value = call.args.teammate;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function agentToolCall(part: ToolCallPart): AgentToolCall | null {
  // A call that failed did nothing with the agent, so it keeps its ordinary row and error.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  if (part.status === "failed") return null;
  const tool = AGENT_TOOLS.find((name) => copilotToolCall(part, name));
  if (!tool) return null;
  const agent = agentField(part, tool);
  if (agent) return { tool, agent: agent.replace(/^@/, "") };
  // Claude shows an ask the moment the model starts it and names the agent only once the whole message is written, so the ask is a card from its first moment.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/967
  const running = part.status === "pending" || part.status === "in_progress";
  return tool === ASK_AGENT_TOOL_NAME && running ? { tool, agent: null } : null;
}

export function agentToolLineText(call: AgentToolCall, name: string): string {
  return TOOL_LINES[call.tool](name);
}
