import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainType";
import { ChatModeSelector } from "@/components/chat-components/ChatModeSelector";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { navigateToPlusPage, useIsPaidUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { CheckCircle, Download, History, MessageCirclePlus, MoreHorizontal } from "lucide-react";
import React from "react";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { TokenCounter } from "./TokenCounter";
import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => Promise<void>;
  onLoadHistory: () => void;
  chatHistory: ChatHistoryItem[];
  onUpdateChatTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLoadChat: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  latestTokenCount?: number | null;
}

export function ChatControls({
  onNewChat,
  onSaveAsNote,
  onLoadHistory,
  chatHistory,
  onUpdateChatTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
  latestTokenCount,
}: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  const isPaidUser = useIsPaidUser();

  const handleModeChange = (chainType: ChainType) => setSelectedChain(chainType);

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-flex-1">
        <ChatModeSelector
          selectedChain={selectedChain}
          isPaidUser={Boolean(isPaidUser)}
          onModeChange={handleModeChange}
          onPlusUpsell={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT)}
        />
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        <div className="tw-mr-2">
          <TokenCounter tokenCount={latestTokenCount ?? null} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
              <MessageCirclePlus className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Chat</TooltipContent>
        </Tooltip>
        <ChatSettingsPopover />
        {!settings.autosaveChat && (
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
        <Tooltip>
          <ChatHistoryPopover
            chatHistory={chatHistory}
            onUpdateTitle={onUpdateChatTitle}
            onDeleteChat={onDeleteChat}
            onLoadChat={onLoadChat}
            onOpenSourceFile={onOpenSourceFile}
          >
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="icon" title="Chat History" onClick={onLoadHistory}>
                <History className="tw-size-4" />
              </Button>
            </TooltipTrigger>
          </ChatHistoryPopover>
          <TooltipContent>Chat History</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="icon" title="Advanced Settings">
              <MoreHorizontal className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="tw-w-64">
            <DropdownMenuItem
              className="tw-flex tw-justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("autoAcceptEdits", !settings.autoAcceptEdits);
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <CheckCircle className="tw-size-4" />
                Auto-accept Edits
              </div>
              <SettingSwitch checked={settings.autoAcceptEdits} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
