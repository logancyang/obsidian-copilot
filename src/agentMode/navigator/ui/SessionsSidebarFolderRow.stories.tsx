import { SessionsSidebarFolderRow } from "@/agentMode/navigator/ui/SessionsSidebarFolderRow";
import { sidebarProject } from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type SessionsSidebarFolderRowProps = React.ComponentProps<typeof SessionsSidebarFolderRow>;

const meta = {
  title: "Agent Mode/Sessions Sidebar Folder Row",
  component: SessionsSidebarFolderRow,
  args: {
    project: sidebarProject("garden", "Garden plans"),
    expanded: false,
    active: false,
    current: false,
    hiddenStatus: "idle",
    onToggle: () => {},
    onNewChat: () => {},
    onDeleted: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<SessionsSidebarFolderRowProps>;
export default meta;

export const Collapsed: StoryObj<SessionsSidebarFolderRowProps> = {};

export const Expanded: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { expanded: true },
};

export const ProjectLandingOpen: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { expanded: true, active: true, current: true },
};

export const CurrentChatInside: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { expanded: true, current: true },
};

export const HiddenRunning: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { hiddenStatus: "running" },
};

export const HiddenUnread: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { hiddenStatus: "unread" },
};

export const HiddenWaiting: StoryObj<SessionsSidebarFolderRowProps> = {
  args: { hiddenStatus: "waiting" },
};

export const LongName: StoryObj<SessionsSidebarFolderRowProps> = {
  args: {
    project: sidebarProject(
      "thesis",
      "Thesis research with a very long project name that must truncate"
    ),
    hiddenStatus: "waiting",
  },
};
