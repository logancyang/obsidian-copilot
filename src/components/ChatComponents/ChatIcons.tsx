import { SetChainOptions } from '@/aiState';
import {
  AI_SENDER,
  ChatModelDisplayNames,
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

import { ChainType } from '@/chainFactory';
import {
  RefreshIcon, SaveAsNoteIcon,
  StopIcon,
  UseActiveNoteAsContextIcon
} from '@/components/Icons';
import { stringToChainType } from '@/utils';
import React from 'react';

interface ChatIconsProps {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onStopGenerating: () => void;
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onForceRebuildActiveNoteContext: () => void;
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
  onForceRebuildActiveNoteContext,
  addMessage,
}) => {
  const [selectedChain, setSelectedChain] = useState<ChainType>(currentChain);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentModel(event.target.value);
  };

  const handleChainChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedChain(stringToChainType(event.target.value));
  }

  useEffect(() => {
    const handleRetrievalQAChain = async () => {
      if (selectedChain !== ChainType.RETRIEVAL_QA_CHAIN) {
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
      if (noteContent) {
        setCurrentChain(selectedChain, { noteContent });
      }
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
            <option value={ChatModelDisplayNames.GPT_35_TURBO}>{ChatModelDisplayNames.GPT_35_TURBO}</option>
            <option value={ChatModelDisplayNames.GPT_35_TURBO_16K}>{ChatModelDisplayNames.GPT_35_TURBO_16K}</option>
            <option value={ChatModelDisplayNames.GPT_4}>{ChatModelDisplayNames.GPT_4}</option>
            <option value={ChatModelDisplayNames.GPT_4_32K}>{ChatModelDisplayNames.GPT_4_32K}</option>
            {/* <option value={ChatModelDisplayNames.CLAUDE_1}>{ChatModelDisplayNames.CLAUDE_1}</option>
            <option value={ChatModelDisplayNames.CLAUDE_1_100K}>{ChatModelDisplayNames.CLAUDE_1_100K}</option>
            <option value={ChatModelDisplayNames.CLAUDE_INSTANT_1}>{ChatModelDisplayNames.CLAUDE_INSTANT_1}</option>
            <option value={ChatModelDisplayNames.CLAUDE_INSTANT_1_100K}>{ChatModelDisplayNames.CLAUDE_INSTANT_1_100K}</option> */}
            <option value={ChatModelDisplayNames.AZURE_GPT_35_TURBO}>{ChatModelDisplayNames.AZURE_GPT_35_TURBO}</option>
            <option value={ChatModelDisplayNames.AZURE_GPT_35_TURBO_16K}>{ChatModelDisplayNames.AZURE_GPT_35_TURBO_16K}</option>
            <option value={ChatModelDisplayNames.AZURE_GPT_4}>{ChatModelDisplayNames.AZURE_GPT_4}</option>
            <option value={ChatModelDisplayNames.AZURE_GPT_4_32K}>{ChatModelDisplayNames.AZURE_GPT_4_32K}</option>
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
      <button className='chat-icon-button' onClick={onForceRebuildActiveNoteContext}>
        <UseActiveNoteAsContextIcon className='icon-scaler' />
        <span className="tooltip-text">Rebuild Index for Active Note</span>
      </button>
    </div>
  );
};

export default ChatIcons;
