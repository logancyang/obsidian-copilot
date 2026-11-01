import { SessionsSidebarRow } from "@/agentMode/ui/SessionsSidebarRow";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type SessionsSidebarRowProps = React.ComponentProps<typeof SessionsSidebarRow>;

const meta = {
  title: "Agent Mode/Sessions Sidebar Row",
  component: SessionsSidebarRow,
  args: {
    title: "Plan the fall product launch",
    status: "idle",
    active: false,
    isSessionOpen: false,
    onSelect: () => {},
    onCloseSession: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<SessionsSidebarRowProps>;
export default meta;

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

export const LongTitle: StoryObj<SessionsSidebarRowProps> = {
  args: {
    title:
      "Investigate why the nightly sync keeps overwriting the reading list after a rename on mobile",
    status: "waiting",
  },
};
