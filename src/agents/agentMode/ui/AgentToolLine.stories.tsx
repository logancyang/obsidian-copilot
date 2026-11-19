import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { FIVE_AGENTS, LONG_NAMED_AGENT } from "@/agents/ui/testing/rosterFixtures";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

interface ToolLineProps {
  calls: AgentToolCall[];
  initiallyOpen?: boolean;
}

const CHAT_AGENTS = { agents: [...FIVE_AGENTS, LONG_NAMED_AGENT], self: "coco" };

function ToolLine({ calls, initiallyOpen = false }: ToolLineProps) {
  const app = useApp();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <AgentToolLine
        calls={calls}
        app={app}
        open={open}
        onToggle={() => setOpen((was) => !was)}
        ordinaryRow={null}
      />
    </ChatAgentsContext.Provider>
  );
}

const SENT =
  "Zero is planning the custom agents launch video and wants your blunt read.\n\nThe plan is in [[Launch video plan]]: a 20-second intro, then six 10-second feature shots.\n\nTheir words: “what do you think of this plan? Be blunt.”";

const meta = {
  title: "Custom Agents/Mention Tool Line",
  component: ToolLine,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ToolLineProps>;
export default meta;

export const Asked: StoryObj<ToolLineProps> = {
  args: { calls: [{ tool: "ask_agent", agent: "Maya", message: SENT }] },
};

export const AskedOpen: StoryObj<ToolLineProps> = {
  args: { calls: [{ tool: "ask_agent", agent: "Maya", message: SENT }], initiallyOpen: true },
};

export const CheckedProgress: StoryObj<ToolLineProps> = {
  args: { calls: [{ tool: "check_agent", agent: "Leo", message: null }] },
};

export const PassedAnswer: StoryObj<ToolLineProps> = {
  args: { calls: [{ tool: "answer_agent", agent: "Leo", message: null }] },
};

export const Stopped: StoryObj<ToolLineProps> = {
  args: { calls: [{ tool: "stop_agent", agent: "Leo", message: null }] },
};

const BUDGET =
  "Zero asks whether the $8k launch budget holds up. The budget is in [[Launch budget]].";

export const AskedSeveral: StoryObj<ToolLineProps> = {
  args: {
    calls: [
      { tool: "ask_agent", agent: "Maya", message: BUDGET },
      { tool: "ask_agent", agent: "Leo", message: BUDGET },
    ],
  },
};

export const AskedSeveralOpen: StoryObj<ToolLineProps> = {
  args: {
    calls: [
      { tool: "ask_agent", agent: "Maya", message: BUDGET },
      {
        tool: "ask_agent",
        agent: "Leo",
        message: "Check the Q4 marketing line in [[Launch budget]].",
      },
    ],
    initiallyOpen: true,
  },
};

export const AskedFiveLongNames: StoryObj<ToolLineProps> = {
  args: {
    calls: ["Maya", "Leo", "Nora", "Kai", LONG_NAMED_AGENT.name].map((agent) => ({
      tool: "ask_agent",
      agent,
      message: BUDGET,
    })),
  },
};
