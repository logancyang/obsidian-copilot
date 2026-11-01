import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTabStripProps = React.ComponentProps<typeof AgentTabStrip>;

interface StoryChat {
  label: string;
  status?: AgentSessionStatus;
  needsAttention?: boolean;
}

function makeManager(chats: StoryChat[], activeIndex = 0): AgentSessionManager {
  const sessions = chats.map((chat, index) => ({
    internalId: `chat-${index}`,
    backendId: "claude",
    subscribe: () => () => {},
    getLabel: () => chat.label,
    getStatus: () => chat.status ?? "idle",
    getNeedsAttention: () => chat.needsAttention ?? false,
  }));
  return {
    subscribe: () => () => {},
    getSessionsForScope: () => sessions,
    getActiveProjectId: () => null,
    getActiveSession: () => sessions[activeIndex],
    getIsStarting: () => false,
  } as unknown as AgentSessionManager;
}

const WithTooltips: React.FC<Partial<AgentTabStripProps>> = (props) => (
  <TooltipProvider>
    <AgentTabStrip {...(props as AgentTabStripProps)} />
  </TooltipProvider>
);

const meta = {
  title: "Agent Mode/Tab Strip",
  component: AgentTabStrip,
  args: { onOpenSidebar: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTabStripProps>;
export default meta;

export const SingleChat: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: { manager: makeManager([{ label: "Summarize the Q3 interview notes" }]) },
};

export const EveryStatus: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: {
    manager: makeManager([
      { label: "Summarize the Q3 interview notes" },
      { label: "Refactor the reading list importer", status: "running" },
      { label: "Draft the release announcement", needsAttention: true },
      { label: "Clean up duplicate project notes", status: "error" },
      { label: "Plan the garden renovation" },
      { label: "Review the weekly template" },
    ]),
  },
};
