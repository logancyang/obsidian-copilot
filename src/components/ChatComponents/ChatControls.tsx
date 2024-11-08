import { SetChainOptions } from "@/aiParams";
import { CopilotPlusModal } from "@/components/CopilotPlusModal";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomError } from "@/error";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { Notice, Vault } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import { RefreshIcon, SaveAsNoteIcon, UseActiveNoteAsContextIcon } from "@/components/Icons";
import { stringToChainType } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";

interface ChatControlsProps {
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  addMessage: (message: ChatMessage) => void;
  settings: CopilotSettings;
  vault: Vault;
  vault_qa_strategy: string;
  debug?: boolean;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  currentModelKey,
  setCurrentModelKey,
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  addMessage,
  settings,
  vault,
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
      <button className="chat-icon-button clickable-icon" onClick={() => onNewChat(false)}>
        <RefreshIcon className="icon-scaler" />
        <span className="tooltip-text">
          New Chat
          <br />
          (unsaved history will be lost)
        </span>
      </button>
      <button className="chat-icon-button clickable-icon" onClick={onSaveAsNote}>
        <SaveAsNoteIcon className="icon-scaler" />
        <span className="tooltip-text">Save as Note</span>
      </button>
      {selectedChain === "vault_qa" && (
        <>
          <button className="chat-icon-button clickable-icon" onClick={onRefreshVaultContext}>
            <UseActiveNoteAsContextIcon className="icon-scaler" />
            <div
              className="tooltip-text"
              style={{
                transform: "translateX(-90%)",
              }}
            >
              <span>Refresh Index for Vault</span>
            </div>
          </button>
          {/* <button className="chat-icon-button clickable-icon" onClick={handleFindSimilarNotes}>
            <ConnectionIcon className="icon-scaler" />
            <span className="tooltip-text">Find Similar Notes for Active Note</span>
          </button> */}
        </>
      )}
      <div className="chat-icon-selection-tooltip">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="chain-select-button">
            {currentChain === "llm_chain" && "Chat Mode"}
            {currentChain === "vault_qa" && "Vault QA Mode (Basic)"}
            {currentChain === "copilot_plus" && "Copilot Plus Mode (Alpha)"}
            <ChevronDown size={10} />
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="chain-select-content">
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "llm_chain" })}>
                Chat Mode
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "vault_qa" })}>
                Vault QA Mode (Basic)
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => handleChainChange({ value: "copilot_plus" })}>
                Copilot Plus Mode (Alpha)
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};

export default ChatControls;
