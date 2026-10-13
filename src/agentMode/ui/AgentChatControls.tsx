import { backendRegistry } from "@/agentMode/backends/registry";
import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { describeChatDelete } from "@/lib/chatDeleteText";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { useSettingsValue } from "@/settings/model";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import {
  Bookmark,
  Download,
  History,
  Link,
  MessageCirclePlus,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useState } from "react";

const resolveDeleteSummary = (item: ChatHistoryItem) =>
  describeChatDelete(item.backendId ? backendRegistry[item.backendId] : undefined);

const resolveHistoryIcon = (item: ChatHistoryItem) =>
  item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;

// An empty chat has no note to link or bookmark, so its items stay visible but explain why they are off.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/702
const NeedsMessageMenuItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div>
        <DropdownMenuItem disabled>{children}</DropdownMenuItem>
      </div>
    </TooltipTrigger>
    <TooltipContent side="left">Send a message to the chat first.</TooltipContent>
  </Tooltip>
);

interface AgentChatControlsProps {
  onNewChat?: () => void;
  onSaveAsNote?: () => void | Promise<void>;
  chatHistoryItems?: ChatHistoryItem[];
  onLoadHistory?: () => void | Promise<void>;
  onLoadChat?: (id: string) => Promise<void>;
  onUpdateChatTitle?: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat?: (id: string) => Promise<void>;
  onCloseSession?: (id: string) => Promise<void>;
  openChatIds?: ReadonlySet<string>;
  runningChatIds?: ReadonlySet<string>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  onCopyChatLink?: () => void | Promise<void>;
  getChatBookmarkState?: () => Promise<ChatBookmarkState>;
  onSetChatBookmarked?: (bookmarked: boolean) => Promise<void>;
  usageMeter?: React.ReactNode;
  showMultiAgentUpsell?: boolean;
}

export const AgentChatControls: React.FC<AgentChatControlsProps> = ({
  onNewChat,
  onSaveAsNote,
  chatHistoryItems,
  onLoadHistory,
  onLoadChat,
  onUpdateChatTitle,
  onDeleteChat,
  onCloseSession,
  openChatIds,
  runningChatIds,
  onOpenSourceFile,
  onCopyChatLink,
  getChatBookmarkState,
  onSetChatBookmarked,
  usageMeter,
  showMultiAgentUpsell = false,
}) => {
  const settings = useSettingsValue();
  const canUseMultiAgent = useCanUseMultiAgent();
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
  );
  const [moreActionsBody, setMoreActionsBody] = useState<HTMLElement | null>(null);
  const trackMoreActionsBody = useCallback(
    (node: HTMLButtonElement | null) => setMoreActionsBody(node?.ownerDocument.body ?? null),
    []
  );

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-ml-1 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
        {showMultiAgentUpsell && !canUseMultiAgent && (
          <Button
            variant="ghost2"
            size="fit"
            className={cn(
              "tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted",
              "hover:tw-text-normal"
            )}
            onClick={() => navigateToPlusPage("multi_agent")}
          >
            <Sparkles className="tw-size-3 tw-shrink-0" />
            <span className="tw-truncate">
              Mention multiple agents with @ (needs Plus tier or above)
            </span>
          </Button>
        )}
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        {usageMeter}
        {onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
                <MessageCirclePlus className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
        )}
        {historyAvailable && (
          <Tooltip>
            <ChatHistoryPopover
              chatHistory={chatHistoryItems!}
              onUpdateTitle={onUpdateChatTitle!}
              onDeleteChat={onDeleteChat!}
              onCloseSession={onCloseSession}
              openChatIds={openChatIds}
              runningChatIds={runningChatIds}
              onLoadChat={onLoadChat}
              onOpenSourceFile={onOpenSourceFile}
              getIcon={resolveHistoryIcon}
              getDeleteSummary={resolveDeleteSummary}
            >
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="icon"
                  title="Chat History"
                  onClick={() => {
                    void onLoadHistory?.();
                  }}
                >
                  <History className="tw-size-4" />
                </Button>
              </TooltipTrigger>
            </ChatHistoryPopover>
            <TooltipContent>Chat History</TooltipContent>
          </Tooltip>
        )}
        {onNewChat && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost2" size="icon" title="More Actions" ref={trackMoreActionsBody}>
                <MoreHorizontal className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={moreActionsBody}>
              {onCopyChatLink ? (
                <DropdownMenuItem onSelect={() => void onCopyChatLink()}>
                  <Link />
                  Copy chat link
                </DropdownMenuItem>
              ) : (
                <NeedsMessageMenuItem>
                  <Link />
                  Copy chat link
                </NeedsMessageMenuItem>
              )}
              {onSetChatBookmarked &&
                (getChatBookmarkState ? (
                  <ChatBookmarkMenuItem
                    getBookmarkState={getChatBookmarkState}
                    onSetBookmarked={safeAsyncHandler(onSetChatBookmarked)}
                  />
                ) : (
                  <NeedsMessageMenuItem>
                    <Bookmark />
                    Add to bookmarks
                  </NeedsMessageMenuItem>
                ))}
              {!settings.autosaveChat && onSaveAsNote && (
                <DropdownMenuItem onSelect={() => void onSaveAsNote()}>
                  <Download />
                  Save chat as note
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
