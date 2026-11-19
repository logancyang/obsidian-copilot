import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTabStripProps = React.ComponentProps<typeof AgentTabStrip>;

interface StoryChat {
  label: string;
  status?: AgentSessionStatus;
  needsAttention?: boolean;
  agentSlug?: string;
  messages?: AgentChatMessage[];
}

const LEO_WAITS: AgentChatMessage[] = [
  {
    id: "asked",
    sender: "user",
    timestamp: null,
    isVisible: true,
    message: "@Leo reconcile October",
    agentMentions: [{ id: "run", agent: "leo", name: "Leo", status: "question", startedAt: 0 }],
  },
];

function makeManager(chats: StoryChat[], activeIndex = 0): AgentSessionManager {
  const sessions = chats.map((chat, index) => ({
    internalId: `chat-${index}`,
    backendId: "claude",
    agentSlug: chat.agentSlug ?? null,
    subscribe: () => () => {},
    getLabel: () => chat.label,
    getStatus: () => chat.status ?? "idle",
    getNeedsAttention: () => chat.needsAttention ?? false,
    store: { getDisplayMessages: () => chat.messages ?? [] },
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

export const AgentAndCopilotChats: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: {
    agents: [COCO, LEO, MAYA, NORA],
    manager: makeManager([
      { label: "Launch video plan", agentSlug: "coco" },
      { label: "October books", agentSlug: "leo", status: "running" },
      { label: "What to cut from the launch video", agentSlug: "maya", needsAttention: true },
      { label: "Winter break schedule", agentSlug: "nora" },
      { label: "Release notes 4.0.21" },
    ]),
  },
};

export const RunningAgentChat: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: {
    agents: [COCO, LEO],
    manager: makeManager([
      { label: "October books", agentSlug: "leo", status: "running" },
      { label: "Release notes 4.0.21", status: "running" },
    ]),
  },
};

export const WaitingAndDoneDots: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: {
    agents: [COCO, LEO, MAYA, NORA],
    manager: makeManager([
      { label: "Release notes 4.0.21" },
      { label: "October books", agentSlug: "coco", needsAttention: true, messages: LEO_WAITS },
      { label: "School pickup", agentSlug: "nora", needsAttention: true },
    ]),
  },
};

export const DotOnOverflow: StoryObj<AgentTabStripProps> = {
  render: WithTooltips,
  args: {
    agents: [COCO, LEO, MAYA, NORA],
    manager: makeManager([
      { label: "Launch video plan", agentSlug: "coco" },
      { label: "Release notes 4.0.21" },
      { label: "Winter break schedule", agentSlug: "nora" },
      { label: "October books", agentSlug: "coco", needsAttention: true, messages: LEO_WAITS },
      { label: "What to cut from the launch video", agentSlug: "maya", needsAttention: true },
    ]),
  },
};
