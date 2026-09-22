import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";
import { ChatHistoryPopover } from "./ChatHistoryPopover";

type Props = React.ComponentProps<typeof ChatHistoryPopover>;

interface StoryHarnessProps {
  title: string;
  onCloseSession: (id: string) => Promise<void>;
  closeOnOpen?: boolean;
}

const StoryHarness: React.FC<StoryHarnessProps> = ({
  title,
  onCloseSession,
  closeOnOpen = false,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    triggerRef.current?.click();
    if (!closeOnOpen) return;

    const tick = window.setInterval(() => {
      const titleElement = Array.from(document.querySelectorAll<HTMLElement>("[title]")).find(
        (candidate) => candidate.title === title
      );
      const closeButton = titleElement
        ?.closest('[role="button"]')
        ?.querySelector<HTMLButtonElement>('[aria-label="Close session"]');
      if (!closeButton) return;
      closeButton.click();
      window.clearInterval(tick);
    }, 50);
    return () => window.clearInterval(tick);
  }, [closeOnOpen, title]);

  const timestamp = new Date("2026-09-21T12:00:00-07:00");
  return (
    <ChatHistoryPopover
      chatHistory={[
        {
          id: title,
          title,
          createdAt: timestamp,
          lastAccessedAt: timestamp,
        },
      ]}
      openChatIds={new Set([title])}
      onCloseSession={onCloseSession}
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
  render: () => <StoryHarness title="Open research session" onCloseSession={async () => {}} />,
};

export const PendingClose: StoryObj<Props> = {
  render: () => (
    <StoryHarness
      title="Closing research session"
      closeOnOpen
      onCloseSession={() => new Promise(() => {})}
    />
  ),
};

export const FailedClose: StoryObj<Props> = {
  render: () => (
    <StoryHarness
      title="Failed research session"
      closeOnOpen
      onCloseSession={async () => {
        throw new Error("Backend unavailable");
      }}
    />
  ),
};
