import { CustomModel, SetChainOptions } from "@/aiParams";
import { AI_SENDER, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { formatDateTime, getFileContent, getFileName } from "@/utils";
import { Notice, Vault } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import {
  RefreshIcon,
  SaveAsNoteIcon,
  SendActiveNoteToPromptIcon,
  UseActiveNoteAsContextIcon,
} from "@/components/Icons";
import { stringToChainType } from "@/utils";

interface ChatIconsProps {
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onSendActiveNoteToPrompt: () => void;
  onForceRebuildActiveNoteContext: () => void;
  onRefreshVaultContext: () => void;
  addMessage: (message: ChatMessage) => void;
  settings: CopilotSettings;
  vault: Vault;
  vault_qa_strategy: string;
  debug?: boolean;
}

const ChatIcons: React.FC<ChatIconsProps> = ({
  currentModelKey,
  setCurrentModelKey,
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onSendActiveNoteToPrompt,
  onForceRebuildActiveNoteContext,
  onRefreshVaultContext,
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
    setSelectedChain(stringToChainType(event.target.value));
  };

  useEffect(() => {
    const handleChainSelection = async () => {
      if (!app) {
        console.error("App instance is not available.");
        return;
      }

      if (selectedChain === ChainType.LONG_NOTE_QA_CHAIN) {
        const file = app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active note found.");
          console.error("No active note found.");
          return;
        }

        const noteContent = await getFileContent(file, vault);
        const fileMetadata = app.metadataCache.getFileCache(file);
        const noteFile = {
          path: file.path,
          basename: file.basename,
          mtime: file.stat.mtime,
          content: noteContent ?? "",
          metadata: fileMetadata?.frontmatter ?? {},
        };

        const noteName = getFileName(file);

        const activeNoteOnMessage: ChatMessage = {
          sender: AI_SENDER,
          message: `OK Feel free to ask me questions about [[${noteName}]]. \n\nPlease note that this is a retrieval-based QA for notes longer than the model context window. Specific questions are encouraged. For generic questions like 'give me a summary', 'brainstorm based on the content', Chat mode with *Send Note to Prompt* button used with a *long context model* is a more suitable choice.`,
          isVisible: true,
          timestamp: formatDateTime(new Date()),
        };
        addMessage(activeNoteOnMessage);
        if (noteContent) {
          setCurrentChain(selectedChain, { noteFile, debug });
        }
        return;
      } else if (selectedChain === ChainType.VAULT_QA_CHAIN) {
        if (vault_qa_strategy === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH) {
          await onRefreshVaultContext();
        }
        const activeNoteOnMessage: ChatMessage = {
          sender: AI_SENDER,
          message: `OK Feel free to ask me questions about your vault: **${app.vault.getName()}**. \n\nIf you have *NEVER* as your auto-index strategy, you must click the *Refresh Index* button below, or run Copilot command: *Index vault for QA* first before you proceed!\n\nPlease note that this is a retrieval-based QA. Specific questions are encouraged. For generic questions like 'give me a summary', 'brainstorm based on the content', Chat mode with *Send Note to Prompt* button used with a *long context model* is a more suitable choice.`,
          isVisible: true,
          timestamp: formatDateTime(new Date()),
        };
        addMessage(activeNoteOnMessage);
      }

      setCurrentChain(selectedChain, { debug });
    };

    handleChainSelection();
  }, [selectedChain]);

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
            <option value="long_note_qa">Long Note QA</option>
            <option value="vault_qa">Vault QA (BETA)</option>
          </select>
          <span className="tooltip-text">Mode Selection</span>
        </div>
      </div>
      {selectedChain === "llm_chain" && (
        <button className="chat-icon-button clickable-icon" onClick={onSendActiveNoteToPrompt}>
          <SendActiveNoteToPromptIcon className="icon-scaler" />
          <span className="tooltip-text">
            Send Note(s) to Prompt
            <br />
            (Set with Copilot command: <br />
            set note context <br />
            in Chat mode.
            <br />
            Default is active note)
          </span>
        </button>
      )}
      {selectedChain === "long_note_qa" && (
        <button
          className="chat-icon-button clickable-icon"
          onClick={onForceRebuildActiveNoteContext}
        >
          <UseActiveNoteAsContextIcon className="icon-scaler" />
          <span className="tooltip-text">
            Refresh Index
            <br />
            for Active Note
          </span>
        </button>
      )}
      {selectedChain === "vault_qa" && (
        <button className="chat-icon-button clickable-icon" onClick={onRefreshVaultContext}>
          <UseActiveNoteAsContextIcon className="icon-scaler" />
          <span className="tooltip-text">
            Refresh Index
            <br />
            for Vault
          </span>
        </button>
      )}
    </div>
  );
};

export default ChatIcons;
