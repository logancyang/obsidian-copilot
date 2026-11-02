import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AgentTabOverflowMenu, AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTabStripProps = React.ComponentProps<typeof AgentTabStrip>;
type AgentTabOverflowMenuProps = React.ComponentProps<typeof AgentTabOverflowMenu>;

interface StoryChat {
  label: string;
  status?: AgentSessionStatus;
  needsAttention?: boolean;
}

function makeSessions(chats: StoryChat[]): AgentSession[] {
  return chats.map(
    (chat, index) =>
      ({
        internalId: `chat-${index}`,
        backendId: "claude",
        subscribe: () => () => {},
        getLabel: () => chat.label,
        getStatus: () => chat.status ?? "idle",
        getNeedsAttention: () => chat.needsAttention ?? false,
      }) as unknown as AgentSession
  );
}

function makeManager(chats: StoryChat[], activeIndex = 0): AgentSessionManager {
  const sessions = makeSessions(chats);
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

const HIDDEN_CHATS = makeSessions([
  { label: "Plan the garden renovation" },
  { label: "Review the weekly template", status: "running" },
  { label: "Draft the release announcement", needsAttention: true },
]);

const OpenOverflowMenu: React.FC<Partial<AgentTabOverflowMenuProps>> = ({ showPlusMarker }) => (
  <TooltipProvider>
    <div className="tw-flex tw-h-72 tw-justify-end">
      <AgentTabOverflowMenu
        sessions={HIDDEN_CHATS}
        activeId={null}
        showPlusMarker={showPlusMarker ?? false}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenNavigator={() => {}}
        defaultOpen
      />
    </div>
  </TooltipProvider>
);

export const OverflowMenuWithoutPlus: StoryObj<AgentTabOverflowMenuProps> = {
  render: OpenOverflowMenu,
  args: { showPlusMarker: true },
};

export const OverflowMenuWithPlus: StoryObj<AgentTabOverflowMenuProps> = {
  render: OpenOverflowMenu,
  args: { showPlusMarker: false },
};
