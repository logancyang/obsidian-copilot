import { backendRegistry } from "@/agentMode/backends/registry";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import { CopyChatLinkButton } from "@/components/chat-components/CopyChatLinkButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navigateToPlusPage, useCanUseMultiAgent } from "@/plusUtils";
import { useSettingsValue } from "@/settings/model";
import { Download, History, MessageCirclePlus, Sparkles } from "lucide-react";
import React from "react";

const resolveHistoryIcon = (item: ChatHistoryItem) =>
  item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;

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
  usageMeter,
  showMultiAgentUpsell = false,
}) => {
  const settings = useSettingsValue();
  const canUseMultiAgent = useCanUseMultiAgent();
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
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
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
                  <MessageCirclePlus className="tw-size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Chat</TooltipContent>
            </Tooltip>
            <CopyChatLinkButton onCopyLink={onCopyChatLink} />
          </>
        )}
        {!settings.autosaveChat && onSaveAsNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title="Save Chat as Note"
                onClick={() => void onSaveAsNote()}
              >
                <Download className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save Chat as Note</TooltipContent>
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
