import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bot, History, MessageCirclePlus } from "lucide-react";
import React from "react";

interface AgentChatControlsProps {
  /** Omit when there's no active session yet (the not-ready state) so the
   * button is hidden — clicking it would be a no-op since there's nothing to
   * clear. */
  onNewChat?: () => void;
  /** Items rendered inside the chat-history popover. */
  chatHistoryItems?: ChatHistoryItem[];
  /** Refresh the popover items (called when the user opens the button). */
  onLoadHistory?: () => void | Promise<void>;
  /** Open a saved chat by id (file path). */
  onLoadChat?: (id: string) => Promise<void>;
  onUpdateChatTitle?: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat?: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
}

/**
 * Minimal control bar for the Agent Chat view. The agent view stands alone
 * (no chain switcher needed), so this only renders New Chat and the chat
 * history popover. Intentionally omits the model picker, project picker,
 * save-as-note, and settings popover — Agent Mode owns its own model/conversation
 * state via ACP.
 */
export const AgentChatControls: React.FC<AgentChatControlsProps> = ({
  onNewChat,
  chatHistoryItems,
  onLoadHistory,
  onLoadChat,
  onUpdateChatTitle,
  onDeleteChat,
  onOpenSourceFile,
}) => {
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
  );

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-ml-1 tw-flex tw-flex-1 tw-items-center tw-gap-1 tw-text-sm tw-text-muted">
        <Bot className="tw-size-4" />
        agent (alpha)
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
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
              onLoadChat={onLoadChat!}
              onOpenSourceFile={onOpenSourceFile}
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
      </div>
    </div>
  );
};
