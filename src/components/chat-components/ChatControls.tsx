import React from "react";
import {
  ChevronDown,
  Download,
  FileText,
  LibraryBig,
  MessageCirclePlus,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setCurrentProject, useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Notice } from "obsidian";
import VectorStoreManager from "@/search/vectorStoreManager";
import { navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";

export async function refreshVaultIndex() {
  try {
    await VectorStoreManager.getInstance().indexVaultToVectorStore();
    new Notice("Vault index refreshed.");
  } catch (error) {
    console.error("Error refreshing vault index:", error);
    new Notice("Failed to refresh vault index. Check console for details.");
  }
}

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onModeChange: (mode: ChainType) => void;
  onCloseProject?: () => void;
}

export function ChatControls({
  onNewChat,
  onSaveAsNote,
  onModeChange,
  onCloseProject,
}: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  const isPlusUser = useIsPlusUser();

  const handleModeChange = (chainType: ChainType) => {
    setSelectedChain(chainType);
    onModeChange(chainType);
    if (chainType !== ChainType.PROJECT_CHAIN) {
      setCurrentProject(null);
      onCloseProject?.();
    }
  };

  return (
    <div className="w-full py-1 flex justify-between items-center px-1">
      <div className="flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="ml-1">
              {selectedChain === ChainType.LLM_CHAIN && "chat"}
              {selectedChain === ChainType.VAULT_QA_CHAIN && "vault QA"}
              {selectedChain === ChainType.COPILOT_PLUS_CHAIN && (
                <div className="flex items-center gap-1">
                  <Sparkles className="size-4" />
                  copilot plus (beta)
                </div>
              )}
              {selectedChain === ChainType.PROJECT_CHAIN && "plus projects (alpha)"}
              <ChevronDown className="size-5 mt-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.LLM_CHAIN);
              }}
            >
              chat
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.VAULT_QA_CHAIN);
              }}
            >
              vault QA
            </DropdownMenuItem>
            {isPlusUser ? (
              <DropdownMenuItem
                onSelect={() => {
                  handleModeChange(ChainType.COPILOT_PLUS_CHAIN);
                }}
              >
                <div className="flex items-center gap-1">
                  <Sparkles className="size-4" />
                  copilot plus (beta)
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT);
                  onCloseProject?.();
                }}
              >
                copilot plus (beta)
                <SquareArrowOutUpRight className="size-3" />
              </DropdownMenuItem>
            )}

            {isPlusUser ? (
              <DropdownMenuItem
                className="flex items-center gap-1"
                onSelect={() => {
                  handleModeChange(ChainType.PROJECT_CHAIN);
                }}
              >
                <LibraryBig className="size-4" />
                plus projects (alpha)
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT);
                  onCloseProject?.();
                }}
              >
                copilot plus (beta)
                <SquareArrowOutUpRight className="size-3" />
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
              <MessageCirclePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" title="Save Chat as Note" onClick={onSaveAsNote}>
              <Download className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save Chat as Note</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="icon" title="Advanced Settings">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem
              className="flex justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("showSuggestedPrompts", !settings.showSuggestedPrompts);
              }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                Suggested Prompt
              </div>
              <SettingSwitch checked={settings.showSuggestedPrompts} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("showRelevantNotes", !settings.showRelevantNotes);
              }}
            >
              <div className="flex items-center gap-2">
                <FileText className="size-4" />
                Relevant Note
              </div>
              <SettingSwitch checked={settings.showRelevantNotes} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2"
              onSelect={() => refreshVaultIndex()}
            >
              <RefreshCw className="size-4" />
              Refresh Vault Index
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
