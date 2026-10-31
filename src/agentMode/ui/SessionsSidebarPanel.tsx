import { SessionsSidebarRow, resolveSessionStatus } from "@/agentMode/ui/SessionsSidebarRow";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import { SquarePen } from "lucide-react";
import React, { useMemo } from "react";

interface SessionsSidebarPanelProps {
  items: readonly ChatHistoryItem[];
  activeChatIds: ReadonlySet<string>;
  runningChatIds: ReadonlySet<string>;
  waitingChatIds: ReadonlySet<string>;
  attentionChatIds: ReadonlySet<string>;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
}

export const SessionsSidebarPanel: React.FC<SessionsSidebarPanelProps> = ({
  items,
  activeChatIds,
  runningChatIds,
  waitingChatIds,
  attentionChatIds,
  onNewChat,
  onOpenChat,
}) => {
  const newestFirst = useMemo(
    () => [...items].sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime()),
    [items]
  );
  return (
    <div className="tw-flex tw-size-full tw-min-h-0 tw-flex-col tw-gap-2 tw-p-2">
      <Button
        variant="ghost2"
        onClick={onNewChat}
        className="tw-h-8 tw-w-full tw-justify-start tw-gap-2 tw-px-2 tw-text-normal"
      >
        <SquarePen className="tw-size-4" />
        New chat
      </Button>
      {newestFirst.length === 0 ? (
        <div className="tw-px-2 tw-py-1.5 tw-text-xs tw-text-muted">No chats yet</div>
      ) : (
        <ul className="tw-m-0 tw-flex tw-min-h-0 tw-flex-1 tw-list-none tw-flex-col tw-gap-0.5 tw-overflow-y-auto tw-p-0">
          {newestFirst.map((item) => (
            <li key={item.id}>
              <SessionsSidebarRow
                title={item.title}
                active={activeChatIds.has(item.id)}
                status={resolveSessionStatus({
                  waiting: waitingChatIds.has(item.id),
                  unread: !!item.needsAttention || attentionChatIds.has(item.id),
                  running: runningChatIds.has(item.id),
                })}
                onSelect={() => onOpenChat(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
