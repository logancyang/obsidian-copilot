import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext, ChatRunsContext } from "@/agents/ui/chatAgents";
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

const EVERY_RUN_FOUND = () => true;

function ToolLines({ lines }: ToolLinesProps) {
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <ChatRunsContext.Provider value={EVERY_RUN_FOUND}>
        {lines.map(({ status = "completed", ...call }, index) => (
          <AgentToolLine
            key={`${call.tool}-${call.agent}`}
            call={call}
            part={{ kind: "tool_call", id: `call-${index}`, title: call.tool, status }}
            ordinaryRow={null}
          />
        ))}
      </ChatRunsContext.Provider>
    </ChatAgentsContext.Provider>
  );
}

const meta = {
  title: "Copilot Teammates/Mention Tool Line",
  component: ToolLines,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ToolLinesProps>;
export default meta;

export const Asking: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_teammate", agent: "Leo", status: "in_progress" }] },
};

export const AskingBeforeTheAgentIsNamed: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_teammate", agent: null, status: "in_progress" }] },
};

export const Messaged: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_teammate", agent: "Leo" }] },
};

export const MessagedSeveralAgents: StoryObj<ToolLinesProps> = {
  args: {
    lines: [
      { tool: "ask_teammate", agent: "Maya" },
      { tool: "ask_teammate", agent: "Leo" },
      { tool: "ask_teammate", agent: "Nora", status: "in_progress" },
    ],
  },
};

export const MessagedLongName: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "ask_teammate", agent: LONG_NAMED_AGENT.name }] },
};

export const CheckedProgress: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "check_teammate", agent: "Leo" }] },
};

export const PassedAnswer: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "answer_teammate", agent: "Leo" }] },
};

export const Stopped: StoryObj<ToolLinesProps> = {
  args: { lines: [{ tool: "stop_teammate", agent: "Leo" }] },
};
