import { SetChainOptions } from "@/aiParams";
import {
  AI_SENDER,
  ChatModelDisplayNames,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import { ProxyServer } from "@/proxyServer";
import { ChatMessage } from "@/sharedState";
import { getFileContent, getFileName } from "@/utils";
import { Notice, Vault } from "obsidian";
import { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import {
  RefreshIcon,
  SaveAsNoteIcon,
  SendActiveNoteToPromptIcon,
  StopIcon,
  UseActiveNoteAsContextIcon,
} from "@/components/Icons";
import { stringToChainType } from "@/utils";
import React from "react";

interface ChatIconsProps {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onStopGenerating: () => void;
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onSendActiveNoteToPrompt: () => void;
  onForceRebuildActiveNoteContext: () => void;
  onRefreshVaultContext: () => void;
  addMessage: (message: ChatMessage) => void;
  vault: Vault;
  vault_qa_strategy: string;
  proxyServer: ProxyServer;
  debug?: boolean;
}

const ChatIcons: React.FC<ChatIconsProps> = ({
  currentModel,
  setCurrentModel,
  currentChain,
  setCurrentChain,
  onStopGenerating,
  onNewChat,
  onSaveAsNote,
  onSendActiveNoteToPrompt,
  onForceRebuildActiveNoteContext,
  onRefreshVaultContext,
  addMessage,
  vault,
  vault_qa_strategy,
  proxyServer,
  debug,
}) => {
  const [selectedChain, setSelectedChain] = useState<ChainType>(currentChain);

  const handleModelChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedModel = event.target.value;
    setCurrentModel(event.target.value);

    if (selectedModel === ChatModelDisplayNames.CLAUDE) {
      // Start the proxy server when CLAUDE is selected
      await proxyServer.startProxyServer('https://api.anthropic.com/');
    } else {
      // Stop the proxy server when another model is selected
      await proxyServer.stopProxyServer();
    }
  };

  useEffect(() => {
    // If Claude is the default, start the proxy server
    const startProxyServerForClaude = async () => {
      if (currentModel === ChatModelDisplayNames.CLAUDE) {
        await proxyServer.startProxyServer('https://api.anthropic.com/');
      }
    };

    // Call the function on component mount
    startProxyServerForClaude();

    // Cleanup function to stop the proxy server when the component unmounts
    return () => {
      proxyServer.stopProxyServer().catch(console.error);
    };
  }, [currentModel, proxyServer]);

  const handleChainChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
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
            className="chat-icon-selection"
            value={currentModel}
            onChange={handleModelChange}
          >
            <option value={ChatModelDisplayNames.GPT_35_TURBO}>
              {ChatModelDisplayNames.GPT_35_TURBO}
            </option>
            <option value={ChatModelDisplayNames.GPT_35_TURBO_16K}>
              {ChatModelDisplayNames.GPT_35_TURBO_16K}
            </option>
            <option value={ChatModelDisplayNames.GPT_4}>
              {ChatModelDisplayNames.GPT_4}
            </option>
            <option value={ChatModelDisplayNames.GPT_4_TURBO}>
              {ChatModelDisplayNames.GPT_4_TURBO}
            </option>
            <option value={ChatModelDisplayNames.GPT_4_32K}>
              {ChatModelDisplayNames.GPT_4_32K}
            </option>
            <option value={ChatModelDisplayNames.AZURE_OPENAI}>
              {ChatModelDisplayNames.AZURE_OPENAI}
            </option>
            <option value={ChatModelDisplayNames.CLAUDE}>
              {ChatModelDisplayNames.CLAUDE}
            </option>
            <option value={ChatModelDisplayNames.GEMINI_PRO}>
              {ChatModelDisplayNames.GEMINI_PRO}
            </option>
            <option value={ChatModelDisplayNames.OPENROUTERAI}>
              {ChatModelDisplayNames.OPENROUTERAI}
            </option>
            <option value={ChatModelDisplayNames.LM_STUDIO}>
              {ChatModelDisplayNames.LM_STUDIO}
            </option>
            <option value={ChatModelDisplayNames.OLLAMA}>
              {ChatModelDisplayNames.OLLAMA}
            </option>
          </select>
          <span className="tooltip-text">Model Selection</span>
        </div>
      </div>
      <button className="chat-icon-button" onClick={onStopGenerating}>
        <StopIcon className="icon-scaler" />
        <span className="tooltip-text">Stop Generating</span>
      </button>
      <button className="chat-icon-button" onClick={onNewChat}>
        <RefreshIcon className="icon-scaler" />
        <span className="tooltip-text">
          New Chat
          <br />
          (unsaved history will be lost)
        </span>
      </button>
      <button className="chat-icon-button" onClick={onSaveAsNote}>
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
        <button className="chat-icon-button" onClick={onSendActiveNoteToPrompt}>
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
          className="chat-icon-button"
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
        <button className="chat-icon-button" onClick={onRefreshVaultContext}>
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
