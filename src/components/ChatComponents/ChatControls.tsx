import { SetChainOptions } from "@/aiParams";
import { CopilotPlusModal } from "@/components/CopilotPlusModal";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomError } from "@/error";
import { CopilotSettings } from "@/settings/SettingsPage";
import { Notice } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import { TooltipActionButton } from "@/components/ChatComponents/TooltipActionButton";
import { stringToChainType } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Puzzle, RefreshCw } from "lucide-react";

interface ChatControlsProps {
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  settings: CopilotSettings;
  vault_qa_strategy: string;
  debug?: boolean;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  settings,
  vault_qa_strategy,
  debug,
}) => {
  const [selectedChain, setSelectedChain] = useState<ChainType>(currentChain);

  const handleChainChange = async ({ value }: { value: string }) => {
    const newChain = stringToChainType(value);
    setSelectedChain(newChain);

    if (newChain === ChainType.COPILOT_PLUS_CHAIN) {
      new CopilotPlusModal(app).open();
      // Reset the selected chain to the previous value
      setSelectedChain(currentChain);
    } else {
      setCurrentChain(newChain, { debug });
    }
  };

  useEffect(() => {
    const handleChainSelection = async () => {
      if (!app) {
        console.error("App instance is not available.");
        return;
      }

      if (selectedChain === ChainType.VAULT_QA_CHAIN) {
        if (vault_qa_strategy === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH) {
          await onRefreshVaultContext();
        }
      }

      try {
        await setCurrentChain(selectedChain, { debug });
      } catch (error) {
        if (error instanceof CustomError) {
          console.error("Error setting QA chain:", error.msg);
          new Notice(`Error: ${error.msg}. Please check your embedding model settings.`);
        } else {
          console.error("Unexpected error setting QA chain:", error);
          new Notice(
            "An unexpected error occurred while setting up the QA chain. Please check the console for details."
          );
        }
      }
    };

    handleChainSelection();
  }, [selectedChain]);

  useEffect(() => {
    setSelectedChain(settings.defaultChainType);
  }, [settings.defaultChainType]);

  // const handleFindSimilarNotes = async () => {
  //   const activeFile = app.workspace.getActiveFile();
  //   if (!activeFile) {
  //     new Notice("No active file");
  //     return;
  //   }

  //   const activeNoteContent = await app.vault.cachedRead(activeFile);
  //   const similarChunks = await onFindSimilarNotes(activeNoteContent, activeFile.path);
  //   new SimilarNotesModal(app, similarChunks).open();
  // };

  return (
    <div className="chat-icons-container">
      <TooltipActionButton
        onClick={() => {
          onNewChat(false);
        }}
        Icon={<RefreshCw className="icon-scaler" />}
      >
        <div>New Chat</div>
        {!settings.autosaveChat && <div>(Unsaved history will be lost)</div>}
      </TooltipActionButton>
      <TooltipActionButton onClick={onSaveAsNote} Icon={<Download className="icon-scaler" />}>
        Save as Note
      </TooltipActionButton>
      {selectedChain === "vault_qa" && (
        <TooltipActionButton
          onClick={onRefreshVaultContext}
          Icon={<Puzzle className="icon-scaler" />}
        >
          Refresh Index for Vault
        </TooltipActionButton>
      )}
      <div className="chat-icon-selection-tooltip">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="chain-select-button">
            {currentChain === "llm_chain" && "chat"}
            {currentChain === "vault_qa" && "vault QA (basic)"}
            {currentChain === "copilot_plus" && "copilot plus (alpha)"}
            <ChevronDown size={10} />
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="chain-select-content">
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "llm_chain" })}>
                chat
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "vault_qa" })}>
                vault QA (basic)
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "copilot_plus" })}>
                copilot plus (alpha)
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};

export default ChatControls;
