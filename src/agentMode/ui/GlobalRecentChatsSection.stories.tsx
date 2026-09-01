import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import type { Meta, StoryObj } from "@/lib/story";
import { MessageSquare } from "lucide-react";
import React from "react";

type GlobalRecentChatsSectionProps = React.ComponentProps<typeof GlobalRecentChatsSection>;

const noop = async () => {};
const noopSync = () => {};

const items: GlobalRecentChatsSectionProps["items"] = Array.from({ length: 60 }, (_, index) => ({
  id: `recent-chat-${index + 1}`,
  title:
    index === 3
      ? "Plan the fall product launch and collect the open questions"
      : `Recent chat ${index + 1}`,
  createdAt: new Date("2026-08-28T18:00:00Z"),
  lastAccessedAt: new Date(Date.parse("2026-08-28T22:00:00Z") - index * 60_000),
}));

const defaultArgs: GlobalRecentChatsSectionProps = {
  items,
  onLoadChat: noop,
  onUpdateTitle: noop,
  onDeleteChat: noop,
  onOpenSourceFile: noop,
  onLoadHistory: noopSync,
};

const meta = {
  title: "Agent Mode/Global Recent Chats Section",
  component: GlobalRecentChatsSection,
  args: defaultArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<GlobalRecentChatsSectionProps>;
export default meta;

function renderShelf(args: Partial<GlobalRecentChatsSectionProps>) {
  const props: GlobalRecentChatsSectionProps = { ...defaultArgs, ...args };
  const sections: AgentHomeShelfSection[] = [
    {
      id: "chats",
      icon: <MessageSquare className="tw-size-4" />,
      title: "Recent Chats",
      renderBody: () => <GlobalRecentChatsSection {...props} />,
    },
  ];

  return <AgentHomeShelf sections={sections} />;
}

export const ShortList: StoryObj<GlobalRecentChatsSectionProps> = {
  args: { items: items.slice(0, 5) },
  render: renderShelf,
};

export const ScrollableList: StoryObj<GlobalRecentChatsSectionProps> = {
  render: renderShelf,
};
