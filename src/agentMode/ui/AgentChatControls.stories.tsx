import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { UsageMeter } from "@/agentMode/ui/AgentContextMeter";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

type AgentChatControlsProps = React.ComponentProps<typeof AgentChatControls>;

const TIMESTAMP = new Date("2026-10-12T09:30:00-07:00");
const CHAT_HISTORY: ChatHistoryItem[] = [
  {
    id: "chats/agent__Plan the Q4 roadmap.md",
    title: "Plan the Q4 roadmap",
    createdAt: TIMESTAMP,
    lastAccessedAt: TIMESTAMP,
  },
];

const withBookmarkState = (state: ChatBookmarkState): Partial<AgentChatControlsProps> => ({
  getChatBookmarkState: async () => state,
  onCopyChatLink: () => undefined,
});

function ControlsStory({
  openMoreActions,
  ...props
}: AgentChatControlsProps & { openMoreActions?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMoreActions) return;
    rootRef.current
      ?.querySelector('button[title="More Actions"]')
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  }, [openMoreActions]);

  return (
    <TooltipProvider>
      <div ref={rootRef}>
        <AgentChatControls {...props} />
      </div>
    </TooltipProvider>
  );
}

const meta = {
  title: "Agent Mode/Chat Controls",
  component: ControlsStory,
  args: {
    onNewChat: () => undefined,
    onSaveAsNote: () => undefined,
    chatHistoryItems: CHAT_HISTORY,
    onLoadChat: async () => {},
    onUpdateChatTitle: async () => {},
    onDeleteChat: async () => {},
    onSetChatBookmarked: async () => {},
    onReportError: () => undefined,
    usageMeter: (
      <UsageMeter
        usage={{ usedTokens: 48_000, contextWindow: 200_000, updatedAt: TIMESTAMP.getTime() }}
        contextWindow={200_000}
        planUsage={null}
      />
    ),
    ...withBookmarkState("not-bookmarked"),
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<AgentChatControlsProps & { openMoreActions?: boolean }>;
export default meta;

type Story = StoryObj<AgentChatControlsProps & { openMoreActions?: boolean }>;

export const Bar: Story = {};

export const MoreActions: Story = {
  args: { openMoreActions: true },
};

export const MoreActionsBookmarked: Story = {
  args: { openMoreActions: true, ...withBookmarkState("bookmarked") },
};

export const MoreActionsBookmarksOff: Story = {
  args: { openMoreActions: true, ...withBookmarkState("off") },
};

export const MoreActionsEmptyChat: Story = {
  args: { openMoreActions: true, getChatBookmarkState: undefined, onCopyChatLink: undefined },
};

export const BelowQueuedMessages: Story = {
  render: (args) => (
    <div className="tw-flex tw-flex-col">
      <QueuedMessageList
        delivering={[{ id: "steer", text: "Only summarize the first two notes." }]}
        held={[{ id: "compact", text: "/compact", rawInput: "/compact" }]}
        onRemove={() => undefined}
        onWithdraw={() => undefined}
      />
      <ControlsStory
        {...args}
        tasksIndicator={
          <RunningTasksIndicator
            tasks={[makeTask(), makeCommandTask()]}
            permissions={[]}
            onOpenTask={() => undefined}
          />
        }
      />
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-text-sm tw-text-muted">
        Composer
      </div>
    </div>
  ),
};
