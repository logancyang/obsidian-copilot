import { SessionsSidebarPanel } from "@/agentMode/ui/SessionsSidebarPanel";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type SessionsSidebarPanelProps = React.ComponentProps<typeof SessionsSidebarPanel>;

const none: ReadonlySet<string> = new Set();

const chat = (id: string, title: string, minutesAgo: number) => ({
  id,
  title,
  createdAt: new Date("2026-10-30T09:00:00Z"),
  lastAccessedAt: new Date(Date.parse("2026-10-31T09:00:00Z") - minutesAgo * 60_000),
});

const meta = {
  title: "Agent Mode/Sessions Sidebar",
  component: SessionsSidebarPanel,
  args: {
    items: [],
    activeChatIds: none,
    runningChatIds: none,
    waitingChatIds: none,
    attentionChatIds: none,
    openChatIds: none,
    onNewChat: () => {},
    onOpenChat: () => {},
    onCloseSession: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<SessionsSidebarPanelProps>;
export default meta;

export const Empty: StoryObj<SessionsSidebarPanelProps> = {};

export const EveryStatus: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: [
      chat("chats/idle.md", "Summarize the Q3 interview notes", 240),
      chat("chats/running.md", "Refactor the reading list importer", 1),
      chat("chats/waiting.md", "Clean up duplicate project notes", 5),
      chat("chats/unread.md", "Draft the release announcement", 30),
      chat("chats/active.md", "Plan the fall product launch", 2),
      chat("chats/live.md", "Outline the garden journal", 15),
      chat(
        "chats/long.md",
        "Investigate why the nightly sync keeps overwriting the reading list after a rename on mobile",
        600
      ),
    ],
    activeChatIds: new Set(["chats/active.md"]),
    runningChatIds: new Set(["chats/running.md"]),
    waitingChatIds: new Set(["chats/waiting.md"]),
    attentionChatIds: new Set(["chats/unread.md", "chats/waiting.md"]),
    openChatIds: new Set([
      "chats/running.md",
      "chats/waiting.md",
      "chats/active.md",
      "chats/live.md",
    ]),
  },
};

export const ManyChats: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: Array.from({ length: 40 }, (_, index) =>
      chat(`chats/chat-${index}.md`, `Research thread ${index + 1}`, index * 45)
    ),
    activeChatIds: new Set(["chats/chat-3.md"]),
    runningChatIds: new Set(["chats/chat-1.md"]),
  },
};
