import React from "react";
import {
  Download,
  MoreHorizontal,
  Sparkles,
  FileText,
  RefreshCw,
  MessageCirclePlus,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Notice } from "obsidian";
import VectorStoreManager from "@/search/vectorStoreManager";

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
}

export function ChatControls({ onNewChat, onSaveAsNote }: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  return (
    <div className="w-full py-1 flex justify-between items-center px-1">
      <div className="flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="ml-1">
              {selectedChain === ChainType.LLM_CHAIN && "chat"}
              {selectedChain === ChainType.VAULT_QA_CHAIN && "vault QA (basic)"}
              {selectedChain === ChainType.COPILOT_PLUS_CHAIN && "copilot plus (beta)"}
              <ChevronDown className="size-5 mt-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.LLM_CHAIN)}>
              chat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.VAULT_QA_CHAIN)}>
              vault QA (basic)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.COPILOT_PLUS_CHAIN)}>
              copilot plus (beta)
            </DropdownMenuItem>
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
