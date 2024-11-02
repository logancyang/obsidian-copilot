import { CustomModel, SetChainOptions } from "@/aiParams";
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

interface ChatControlsProps {
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  onFindSimilarNotes: (content: string, activeFilePath: string) => Promise<any>;
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
  onFindSimilarNotes,
  addMessage,
  settings,
  vault,
  vault_qa_strategy,
  debug,
}) => {
  const [selectedChain, setSelectedChain] = useState<ChainType>(currentChain);

  const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

  const handleModelChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedModelKey = event.target.value;
    setCurrentModelKey(selectedModelKey);
  };

  const handleChainChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newChain = stringToChainType(event.target.value);
    setSelectedChain(newChain);

    if (newChain === ChainType.COPILOT_PLUS) {
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
      <div className="chat-icon-selection-tooltip">
        <div className="select-wrapper">
          <select
            id="aiModelSelect"
            className="chat-icon-selection model-select"
            value={currentModelKey}
            onChange={handleModelChange}
          >
            {settings.activeModels
              .filter((model) => model.enabled)
              .map((model) => (
                <option key={getModelKey(model)} value={getModelKey(model)}>
                  {model.name}
                </option>
              ))}
          </select>
          <span className="tooltip-text">Model Selection</span>
        </div>
      </div>
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
      <div className="chat-icon-selection-tooltip">
        <div className="select-wrapper">
          <select
            id="aiChainSelect"
            className="chat-icon-selection"
            value={currentChain}
            onChange={handleChainChange}
          >
            <option value="llm_chain">Chat</option>
            <option value="vault_qa">Vault QA (Basic)</option>
            <option value="copilot_plus">Copilot Plus (Alpha)</option>
          </select>
          <span className="tooltip-text">Mode Selection</span>
        </div>
      </div>
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
    </div>
  );
};

export default ChatControls;
