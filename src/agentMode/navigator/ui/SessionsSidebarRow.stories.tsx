import { SessionsSidebarRow } from "@/agentMode/navigator/ui/SessionsSidebarRow";
import {
  inertChatActions,
  sidebarChat,
} from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type SessionsSidebarRowProps = React.ComponentProps<typeof SessionsSidebarRow>;

const meta = {
  title: "Agent Mode/Sessions Sidebar Row",
  component: SessionsSidebarRow,
  args: {
    item: sidebarChat("chats/plan.md", "Plan the fall product launch", 5, {
      backendId: "claude",
    }),
    status: "idle",
    active: false,
    isSessionOpen: false,
    actions: inertChatActions({ onCloseSession: async () => {} }),
    onSelect: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<SessionsSidebarRowProps>;
export default meta;

const longTitle =
  "Investigate why the nightly sync keeps overwriting the reading list after a rename on mobile";

export const Idle: StoryObj<SessionsSidebarRowProps> = {};

export const Running: StoryObj<SessionsSidebarRowProps> = {
  args: { status: "running" },
};

export const WaitingForPermission: StoryObj<SessionsSidebarRowProps> = {
  args: { status: "waiting" },
};

export const UnreadResult: StoryObj<SessionsSidebarRowProps> = {
  args: { status: "unread" },
};

export const SessionOpen: StoryObj<SessionsSidebarRowProps> = {
  args: { isSessionOpen: true },
};

export const SessionOpenAndRunning: StoryObj<SessionsSidebarRowProps> = {
  args: { isSessionOpen: true, status: "running" },
};

export const Active: StoryObj<SessionsSidebarRowProps> = {
  args: { active: true },
};

export const ActiveAndRunning: StoryObj<SessionsSidebarRowProps> = {
  args: { active: true, status: "running" },
};

export const PinnedWithProjectLabel: StoryObj<SessionsSidebarRowProps> = {
  args: { projectName: "Fall product launch", status: "unread" },
};

export const SessionOpenWithUnreadResult: StoryObj<SessionsSidebarRowProps> = {
  args: { isSessionOpen: true, status: "unread" },
};

export const NoAgentRecorded: StoryObj<SessionsSidebarRowProps> = {
  args: { item: sidebarChat("chats/old.md", "Imported chat from an older version", 900) },
};

export const LongTitle: StoryObj<SessionsSidebarRowProps> = {
  args: {
    item: sidebarChat("chats/long.md", longTitle, 600),
    projectName: "Fall product launch",
    status: "waiting",
    isSessionOpen: true,
  },
};
