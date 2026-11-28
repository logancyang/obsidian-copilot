import { AgentMentionPill } from "@/agents/ui/AgentMentionPillNode";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { LONG_NAMED_AGENT, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import ChatSingleMessage from "./ChatSingleMessage";
import { PillBadge } from "./pills/PillBadge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import type { ChatMessage } from "@/types/message";
import React from "react";

interface MentionPillsProps {
  message: string;
  agents: string[];
}

const CHAT_AGENTS = { agents: [...THREE_AGENTS, LONG_NAMED_AGENT], self: null };

function MentionPills({ message, agents }: MentionPillsProps) {
  const app = useApp();
  const sent: ChatMessage = {
    id: "mention",
    sender: "user",
    message,
    isVisible: true,
    timestamp: null,
    context: { notes: [], urls: [], agents },
  };
  const named = CHAT_AGENTS.agents.filter((agent) => agents.includes(agent.name));
  return (
    <ChatAgentsContext.Provider value={CHAT_AGENTS}>
      <TooltipProvider>
        <div className="tw-flex tw-flex-col tw-gap-4">
          <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3 tw-text-sm">
            {named.map((agent) => (
              <AgentMentionPill key={agent.slug} name={agent.name} faceSrc={agent.faceSrc} />
            ))}{" "}
            what do you think of this plan? <PillBadge>Launch video plan</PillBadge>
          </div>
          <ChatSingleMessage message={sent} app={app} isStreaming={false} />
        </div>
      </TooltipProvider>
    </ChatAgentsContext.Provider>
  );
}

const meta = {
  title: "Copilot Teammates/Mention Pill",
  component: MentionPills,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MentionPillsProps>;
export default meta;

export const InTheComposerAndTheSentMessage: StoryObj<MentionPillsProps> = {
  args: {
    message: `@${MAYA.name} what do you think of this plan? Be blunt. [[Launch video plan]]`,
    agents: [MAYA.name],
  },
};

export const LongName: StoryObj<MentionPillsProps> = {
  args: {
    message: `@${LONG_NAMED_AGENT.name} who picks up Mia on Thursday, and does the winter break rota still hold?`,
    agents: [LONG_NAMED_AGENT.name],
  },
};
