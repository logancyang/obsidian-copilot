import { SetChainOptions } from '@/aiState';
import {
  AI_SENDER,
  AZURE_GPT_35_TURBO,
  AZURE_GPT_35_TURBO_DISPLAY_NAME,
  AZURE_GPT_4_32K_DISPLAY_NAME,
  AZURE_GPT_4_DISPLAY_NAME,
  CLAUDE_1,
  CLAUDE_1_100K,
  CLAUDE_1_100K_DISPLAY_NAME,
  CLAUDE_1_DISPLAY_NAME,
  CLAUDE_INSTANT_1,
  CLAUDE_INSTANT_1_100K,
  CLAUDE_INSTANT_1_100K_DISPLAY_NAME,
  CLAUDE_INSTANT_1_DISPLAY_NAME,
  GPT_35_TURBO,
  GPT_35_TURBO_16K,
  GPT_35_TURBO_16K_DISPLAY_NAME,
  GPT_35_TURBO_DISPLAY_NAME,
  GPT_4,
  GPT_4_32K,
  GPT_4_32K_DISPLAY_NAME,
  GPT_4_DISPLAY_NAME,
} from '@/constants';
import {
  ChatMessage
} from '@/sharedState';
import {
  getFileContent,
  getFileName,
} from '@/utils';
import { Notice } from 'obsidian';
import {
  useEffect,
  useState,
} from 'react';

import { RETRIEVAL_QA_CHAIN } from '@/chainFactory';
import {
  RefreshIcon, SaveAsNoteIcon,
  StopIcon,
  UseActiveNoteAsContextIcon
} from '@/components/Icons';
import React from 'react';

interface ChatIconsProps {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  currentChain: string;
  setCurrentChain: (chain: string, options?: SetChainOptions) => void;
  onStopGenerating: () => void;
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onUseActiveNoteAsContext: () => void;
  addMessage: (message: ChatMessage) => void;
}

const ChatIcons: React.FC<ChatIconsProps> = ({
  currentModel,
  setCurrentModel,
  currentChain,
  setCurrentChain,
  onStopGenerating,
  onNewChat,
  onSaveAsNote,
  onUseActiveNoteAsContext,
  addMessage,
}) => {
  const [selectedChain, setSelectedChain] = useState<string>(currentChain);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentModel(event.target.value);
  };

  const handleChainChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedChain(event.target.value);
  }

  useEffect(() => {
    const handleRetrievalQAChain = async () => {
      if (selectedChain !== RETRIEVAL_QA_CHAIN) {
        setCurrentChain(selectedChain);
        return;
      }

      if (!app) {
        console.error('App instance is not available.');
        return;
      }

      const file = app.workspace.getActiveFile();
      if (!file) {
        new Notice('No active note found.');
        console.error('No active note found.');
        return;
      }
      const noteContent = await getFileContent(file);
      const noteName = getFileName(file);

      const activeNoteOnMessage: ChatMessage = {
        sender: AI_SENDER,
        message: `OK Feel free to ask me questions about [[${noteName}]].`,
        isVisible: true,
      };
      addMessage(activeNoteOnMessage);

      setCurrentChain(selectedChain, { noteContent });
    };

    handleRetrievalQAChain();
  }, [selectedChain]);

  return (
    <div className='chat-icons-container'>
      <div className="chat-icon-selection-tooltip">
        <div className="select-wrapper">
          <select
            id="aiModelSelect"
            className='chat-icon-selection'
            value={currentModel}
            onChange={handleModelChange}
          >
            <option value={GPT_35_TURBO}>{GPT_35_TURBO_DISPLAY_NAME}</option>
            <option value={GPT_35_TURBO_16K}>{GPT_35_TURBO_16K_DISPLAY_NAME}</option>
            <option value={GPT_4}>{GPT_4_DISPLAY_NAME}</option>
            <option value={GPT_4_32K}>{GPT_4_32K_DISPLAY_NAME}</option>
            <option value={CLAUDE_1}>{CLAUDE_1_DISPLAY_NAME}</option>
            <option value={CLAUDE_1_100K}>{CLAUDE_1_100K_DISPLAY_NAME}</option>
            <option value={CLAUDE_INSTANT_1}>{CLAUDE_INSTANT_1_DISPLAY_NAME}</option>
            <option value={CLAUDE_INSTANT_1_100K}>{CLAUDE_INSTANT_1_100K_DISPLAY_NAME}</option>
            <option value={AZURE_GPT_35_TURBO}>{AZURE_GPT_35_TURBO_DISPLAY_NAME}</option>
            <option value={GPT_4}>{AZURE_GPT_4_DISPLAY_NAME}</option>
            <option value={GPT_4_32K}>{AZURE_GPT_4_32K_DISPLAY_NAME}</option>
          </select>
          <span className="tooltip-text">Model Selection</span>
        </div>
      </div>
      <button className='chat-icon-button' onClick={onStopGenerating}>
        <StopIcon className='icon-scaler' />
        <span className="tooltip-text">Stop Generating</span>
      </button>
      <button className='chat-icon-button' onClick={onNewChat}>
        <RefreshIcon className='icon-scaler' />
        <span className="tooltip-text">New Chat<br/>(unsaved history will be lost)</span>
      </button>
      <button className='chat-icon-button' onClick={onSaveAsNote}>
        <SaveAsNoteIcon className='icon-scaler' />
        <span className="tooltip-text">Save as Note</span>
      </button>
      <div className="chat-icon-selection-tooltip">
        <div className="select-wrapper">
          <select
            id="aiChainSelect"
            className='chat-icon-selection'
            value={currentChain}
            onChange={handleChainChange}
          >
            <option value='llm_chain'>Conversation</option>
            <option value='retrieval_qa'>QA: Active Note</option>
          </select>
          <span className="tooltip-text">Mode Selection</span>
        </div>
      </div>
      <button className='chat-icon-button' onClick={onUseActiveNoteAsContext}>
        <UseActiveNoteAsContextIcon className='icon-scaler' />
        <span className="tooltip-text">Rebuild Index for Active Note</span>
      </button>
    </div>
  );
};

export default ChatIcons;
