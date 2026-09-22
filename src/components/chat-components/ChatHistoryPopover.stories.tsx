import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";
import { ChatHistoryPopover } from "./ChatHistoryPopover";

type Props = React.ComponentProps<typeof ChatHistoryPopover>;

const TITLE = "Open research session";
const TIMESTAMP = new Date("2026-09-21T12:00:00-07:00");
const OPEN_CHAT_IDS = new Set([TITLE]);
const CHAT_HISTORY = [
  {
    id: TITLE,
    title: TITLE,
    createdAt: TIMESTAMP,
    lastAccessedAt: TIMESTAMP,
  },
];

const OpenPopover: React.FC<{ isRunning?: boolean }> = ({ isRunning = false }) => {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    triggerRef.current?.click();
  }, []);

  return (
    <ChatHistoryPopover
      chatHistory={CHAT_HISTORY}
      openChatIds={OPEN_CHAT_IDS}
      runningChatIds={isRunning ? OPEN_CHAT_IDS : undefined}
      onCloseSession={async () => {}}
      onUpdateTitle={async () => {}}
      onDeleteChat={async () => {}}
      onLoadChat={async () => {}}
    >
      <button ref={triggerRef} type="button">
        Open chat history
      </button>
    </ChatHistoryPopover>
  );
};

const meta = {
  title: "Chat/Chat History Popover",
  component: ChatHistoryPopover,
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const OpenSession: StoryObj<Props> = {
  render: () => <OpenPopover />,
};

export const Responding: StoryObj<Props> = {
  render: () => <OpenPopover isRunning />,
};
