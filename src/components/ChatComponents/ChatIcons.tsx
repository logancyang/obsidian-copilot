import {
  RefreshIcon, SaveAsNoteIcon,
  StopIcon,
  UseActiveNoteAsContextIcon
} from '@/components/Icons';
import React from 'react';

interface ChatIconsProps {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  onStopGenerating: () => void;
  onNewChat: () => void;
  onSaveAsNote: () => void;
  onUseActiveNoteAsContext: () => void;
}

const ChatIcons: React.FC<ChatIconsProps> = ({
  currentModel,
  setCurrentModel,
  onStopGenerating,
  onNewChat,
  onSaveAsNote,
  onUseActiveNoteAsContext,
}) => {
  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentModel(event.target.value);
  };

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
            <option value='gpt-3.5-turbo'>GPT-3.5</option>
            <option value='gpt-4'>GPT-4</option>
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
      <button className='chat-icon-button' onClick={onUseActiveNoteAsContext}>
        <UseActiveNoteAsContextIcon className='icon-scaler' />
        <span className="tooltip-text">Use Active Note as Context</span>
      </button>
    </div>
  );
};

export default ChatIcons;
