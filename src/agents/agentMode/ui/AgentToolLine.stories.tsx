import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

interface ToolLineProps {
  call: AgentToolCall;
  initiallyOpen?: boolean;
}

const CHAT_AGENTS = { agents: THREE_AGENTS, self: "coco" };

function ToolLine({ call, initiallyOpen = false }: ToolLineProps) {
  const app = useApp();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <AgentToolLine
        call={call}
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
  args: { call: { tool: "ask_agent", agent: "Maya", message: SENT } },
};

export const AskedOpen: StoryObj<ToolLineProps> = {
  args: { call: { tool: "ask_agent", agent: "Maya", message: SENT }, initiallyOpen: true },
};

export const CheckedProgress: StoryObj<ToolLineProps> = {
  args: { call: { tool: "check_agent", agent: "Leo", message: null } },
};

export const PassedAnswer: StoryObj<ToolLineProps> = {
  args: { call: { tool: "answer_agent", agent: "Leo", message: null } },
};

export const Stopped: StoryObj<ToolLineProps> = {
  args: { call: { tool: "stop_agent", agent: "Leo", message: null } },
};
