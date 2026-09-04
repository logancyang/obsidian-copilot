import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainType";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { navigateToPlusPage, useIsPaidUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  CheckCircle,
  ChevronDown,
  Download,
  History,
  MessageCirclePlus,
  MoreHorizontal,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="tw-ml-1 tw-text-sm tw-text-muted">
              {selectedChain === ChainType.LLM_CHAIN && "chat (free)"}
              {selectedChain === ChainType.VAULT_QA_CHAIN && "vault QA (free)"}
              {selectedChain === ChainType.COPILOT_PLUS_CHAIN && (
                <div className="tw-flex tw-items-center tw-gap-1">
                  <Sparkles className="tw-size-4" />
                  copilot plus
                </div>
              )}
              <ChevronDown className="tw-mt-0.5 tw-size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => handleModeChange(ChainType.LLM_CHAIN)}>
              chat (free)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleModeChange(ChainType.VAULT_QA_CHAIN)}>
              vault QA (free)
            </DropdownMenuItem>
            {isPaidUser ? (
              <DropdownMenuItem onSelect={() => handleModeChange(ChainType.COPILOT_PLUS_CHAIN)}>
                <div className="tw-flex tw-items-center tw-gap-1">
                  <Sparkles className="tw-size-4" />
                  copilot plus
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT)}
              >
                copilot plus
                <SquareArrowOutUpRight className="tw-size-3" />
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
