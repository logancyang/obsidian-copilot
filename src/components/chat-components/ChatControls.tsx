import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainType";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { logError } from "@/logger";
import { getSearchBackend } from "@/miyo/miyoUtils";
import { navigateToPlusPage, useIsPaidUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { useApp } from "@/context";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Download,
  History,
  MessageCirclePlus,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Notice } from "obsidian";
import React from "react";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { TokenCounter } from "./TokenCounter";
import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";

async function refreshVaultIndex() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.enableSemanticSearchV3) {
      // Use VectorStoreManager for semantic search indexing
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(false, {
        userInitiated: true,
      });
      if (getSearchBackend(settings) === "miyo") {
        new Notice("Miyo folder index refresh started. Open the Miyo app to check details.");
      } else {
        new Notice(`Semantic search index refreshed with ${count} documents.`);
      }
    } else {
      // V3 search builds indexes on demand
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    logError("Error refreshing vault index:", error);
    new Notice("Failed to refresh vault index. Check console for details.");
  }
}

async function forceReindexVault() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.enableSemanticSearchV3) {
      // Use VectorStoreManager for semantic search indexing
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(true, {
        userInitiated: true,
      });
      if (getSearchBackend(settings) === "miyo") {
        new Notice("Miyo folder index refresh started. Open the Miyo app to check details.");
      } else {
        new Notice(`Semantic search index rebuilt with ${count} documents.`);
      }
    } else {
      // V3 search builds indexes on demand
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    logError("Error force reindexing vault:", error);
    new Notice("Failed to force reindex vault. Check console for details.");
  }
}

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
  const app = useApp();
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
                updateSetting("showSuggestedPrompts", !settings.showSuggestedPrompts);
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <Sparkles className="tw-size-4" />
                Suggested Prompt
              </div>
              <SettingSwitch checked={settings.showSuggestedPrompts} />
            </DropdownMenuItem>
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
            <DropdownMenuItem
              className="tw-flex tw-items-center tw-gap-2"
              onSelect={() => void refreshVaultIndex()}
            >
              <RefreshCw className="tw-size-4" />
              Refresh Vault Index
            </DropdownMenuItem>
            <DropdownMenuItem
              className="tw-flex tw-items-center tw-gap-2"
              onSelect={() => {
                const modal = new ConfirmModal(
                  app,
                  () => forceReindexVault(),
                  "This will delete and rebuild your entire vault index from scratch. This operation cannot be undone. Are you sure you want to proceed?",
                  "Force Reindex Vault"
                );
                modal.open();
              }}
            >
              <AlertTriangle className="tw-size-4" />
              Force Reindex Vault
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
