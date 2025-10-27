import { getCurrentProject, setCurrentProject, setProjectLoading, useChainType } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { ChainType } from "@/chainFactory";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { logError } from "@/logger";
import { navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Docs4LLMParser } from "@/tools/FileParserManager";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  History,
  LibraryBig,
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

export async function refreshVaultIndex() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.enableSemanticSearchV3) {
      // Use VectorStoreManager for semantic search indexing
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
      new Notice(`Semantic search index refreshed with ${count} documents.`);
    } else {
      // V3 search builds indexes on demand
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    console.error("Error refreshing vault index:", error);
    new Notice("Failed to refresh vault index. Check console for details.");
  }
}

export async function forceReindexVault() {
  try {
    const { getSettings } = await import("@/settings/model");
    const settings = getSettings();

    if (settings.enableSemanticSearchV3) {
      // Use VectorStoreManager for semantic search indexing
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
      new Notice(`Semantic search index rebuilt with ${count} documents.`);
    } else {
      // V3 search builds indexes on demand
      new Notice("Lexical search builds indexes on demand. No manual indexing required.");
    }
  } catch (error) {
    console.error("Error force reindexing vault:", error);
    new Notice("Failed to force reindex vault. Check console for details.");
  }
}

export async function reloadCurrentProject() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    new Notice("No project is currently selected to reload.");
    return;
  }

  // Directly execute the reload logic without a confirmation modal
  try {
    setProjectLoading(true); // Start loading indicator

    // Invalidate the markdown context first. This also cleans up file references
    // for files that no longer match project patterns. It will also clear
    // web/youtube contexts to force their reload.
    await ProjectContextCache.getInstance().invalidateMarkdownContext(currentProject, true);

    // Then, trigger the full load and processing logic via ProjectManager.
    // getProjectContext will call loadProjectContext if markdownNeedsReload is true (which it is now).
    // loadProjectContext will handle markdown, web, youtube, and other file types (including API calls for new ones).
    const plugin = (app as any).plugins.getPlugin("copilot");
    if (plugin && plugin.projectManager) {
      await plugin.projectManager.getProjectContext(currentProject.id);
      new Notice(`Project context for "${currentProject.name}" reloaded successfully.`);
    } else {
      throw new Error("Copilot plugin or ProjectManager not available.");
    }
  } catch (error) {
    logError("Error reloading project context:", error);

    // Check if this is a rate limit error and let the FileParserManager notice handle it
    if (!isRateLimitError(error)) {
      new Notice("Failed to reload project context. Check console for details.");
    }
    // If it's a rate limit error, don't show generic failure message - let the rate limit notice show
  } finally {
    setProjectLoading(false); // Stop loading indicator
  }
}

export async function forceRebuildCurrentProjectContext() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    new Notice("No project is currently selected to rebuild.");
    return;
  }

  const modal = new ConfirmModal(
    app,
    async () => {
      try {
        setProjectLoading(true); // Start loading indicator
        new Notice(
          `Force rebuilding context for project: ${currentProject.name}... This will take some time and re-fetch all data.`,
          10000 // Longer notice as this is a bigger operation
        );

        // Step 1: Completely clear all cached data for this project (in-memory and on-disk)
        // Reset rate limit notice timer to allow showing notices during force rebuild
        Docs4LLMParser.resetRateLimitNoticeTimer();

        await ProjectContextCache.getInstance().clearForProject(currentProject);
        new Notice(`Cache for project "${currentProject.name}" has been cleared.`);

        // Step 2: Trigger a full reload from scratch.
        // getProjectContext will call loadProjectContext as the cache is now empty.
        // loadProjectContext will handle markdown, web, youtube, and all other file types.
        const plugin = (app as any).plugins.getPlugin("copilot");
        if (plugin && plugin.projectManager) {
          await plugin.projectManager.getProjectContext(currentProject.id);
          new Notice(
            `Project context for "${currentProject.name}" rebuilt successfully from scratch.`
          );
        } else {
          throw new Error("Copilot plugin or ProjectManager not available for rebuild.");
        }
      } catch (error) {
        logError("Error force rebuilding project context:", error);

        // Check if this is a rate limit error and let the FileParserManager notice handle it
        if (!isRateLimitError(error)) {
          new Notice("Failed to force rebuild project context. Check console for details.");
        }
        // If it's a rate limit error, don't show generic failure message - let the rate limit notice show
      } finally {
        setProjectLoading(false); // Stop loading indicator
      }
    },
    // Confirmation message with a strong warning
    `DANGER: This will permanently delete all cached data (markdown, web URLs, YouTube transcripts, and processed file content) for the project "${currentProject.name}" from both memory and disk. The context will then be rebuilt from scratch, re-fetching all remote data and re-processing all local files. This cannot be undone. Are you absolutely sure?`,
    "Force Rebuild Project Context" // Modal title
  );
  modal.open();
}

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onLoadHistory: () => void;
  onModeChange: (mode: ChainType) => void;
  onCloseProject?: () => void;
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
  onModeChange,
  onCloseProject,
  chatHistory,
  onUpdateChatTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
  latestTokenCount,
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
              {selectedChain === ChainType.PROJECT_CHAIN && "projects (alpha)"}
              <ChevronDown className="tw-mt-0.5 tw-size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.LLM_CHAIN);
              }}
            >
              chat (free)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.VAULT_QA_CHAIN);
              }}
            >
              vault QA (free)
            </DropdownMenuItem>
            {isPlusUser ? (
              <DropdownMenuItem
                onSelect={() => {
                  handleModeChange(ChainType.COPILOT_PLUS_CHAIN);
                }}
              >
                <div className="tw-flex tw-items-center tw-gap-1">
                  <Sparkles className="tw-size-4" />
                  copilot plus
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT);
                  onCloseProject?.();
                }}
              >
                copilot plus
                <SquareArrowOutUpRight className="tw-size-3" />
              </DropdownMenuItem>
            )}

            {isPlusUser ? (
              <DropdownMenuItem
                className="tw-flex tw-items-center tw-gap-1"
                onSelect={() => {
                  handleModeChange(ChainType.PROJECT_CHAIN);
                }}
              >
                <LibraryBig className="tw-size-4" />
                projects (alpha)
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT);
                  onCloseProject?.();
                }}
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
        {selectedChain !== ChainType.PROJECT_CHAIN && <ChatSettingsPopover />}
        {!settings.autosaveChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="icon" title="Save Chat as Note" onClick={onSaveAsNote}>
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
                updateSetting("showRelevantNotes", !settings.showRelevantNotes);
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <FileText className="tw-size-4" />
                Relevant Note
              </div>
              <SettingSwitch checked={settings.showRelevantNotes} />
            </DropdownMenuItem>
            {selectedChain === ChainType.PROJECT_CHAIN ? (
              <>
                <DropdownMenuItem
                  className="tw-flex tw-items-center tw-gap-2"
                  onSelect={() => reloadCurrentProject()}
                >
                  <RefreshCw className="tw-size-4" />
                  Reload Current Project
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-flex tw-items-center tw-gap-2"
                  onSelect={() => forceRebuildCurrentProjectContext()}
                >
                  <AlertTriangle className="tw-size-4" />
                  Force Rebuild Context
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  className="tw-flex tw-items-center tw-gap-2"
                  onSelect={() => refreshVaultIndex()}
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
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
