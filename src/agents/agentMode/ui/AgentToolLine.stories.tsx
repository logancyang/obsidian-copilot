import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { FIVE_AGENTS, LONG_NAMED_AGENT } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

interface ToolLine extends AgentToolCall {
  status?: ToolCallPart["status"];
}

interface ToolLinesProps {
  lines: ToolLine[];
}

const CHAT_AGENTS = {
  agents: [...FIVE_AGENTS, LONG_NAMED_AGENT],
  self: "coco",
  openRun: () => {},
};

function ToolLines({ lines }: ToolLinesProps) {
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      {lines.map(({ status = "completed", ...call }, index) => (
        <AgentToolLine
          key={`${call.tool}-${call.agent}`}
          call={call}
          part={{ kind: "tool_call", id: `call-${index}`, title: call.tool, status }}
          ordinaryRow={null}
        />
      ))}
    </ChatAgentsContext.Provider>
  );
}

const meta = {
  title: "Custom Agents/Mention Tool Line",
  component: ToolLines,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ToolLinesProps>;
export default meta;

export const Asking: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_agent", agent: "Leo", status: "in_progress" }] },
};

export const Messaged: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_agent", agent: "Leo" }] },
};

export const MessagedSeveralAgents: StoryObj<ToolLinesProps> = {
  args: {
    lines: [
      { tool: "ask_agent", agent: "Maya" },
      { tool: "ask_agent", agent: "Leo" },
      { tool: "ask_agent", agent: "Nora", status: "in_progress" },
    ],
  },
};

export const MessagedLongName: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_agent", agent: LONG_NAMED_AGENT.name }] },
};

export const CheckedProgress: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "check_agent", agent: "Leo" }] },
};

export const PassedAnswer: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "answer_agent", agent: "Leo" }] },
};

export const Stopped: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "stop_agent", agent: "Leo" }] },
};
