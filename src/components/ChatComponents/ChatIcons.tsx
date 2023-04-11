import React from 'react';
import { RefreshIcon, SaveAsNoteIcon, UseActiveNoteAsContextIcon } from '@/components/Icons';

interface ChatIconsProps {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  onNewChat: () => void;
  onSaveAsNote: () => void;
}

const ChatIcons: React.FC<ChatIconsProps> = ({
  currentModel,
  setCurrentModel,
  onNewChat,
  onSaveAsNote
}) => {
  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentModel(event.target.value);
  };

  const handleUseActiveNoteAsContext = () => {
    console.log('Use active note as context button clicked');
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
      <button className='chat-icon-button' onClick={onNewChat}>
        <RefreshIcon className='icon-scaler' />
        <span className="tooltip-text">New Chat<br/>(unsaved history will be lost)</span>
      </button>
      <button className='chat-icon-button' onClick={onSaveAsNote}>
        <SaveAsNoteIcon className='icon-scaler' />
        <span className="tooltip-text">Save as Note</span>
      </button>
      <button className='chat-icon-button' onClick={handleUseActiveNoteAsContext}>
        <UseActiveNoteAsContextIcon className='icon-scaler' />
        <span className="tooltip-text">Use Active Note as Context</span>
      </button>
    </div>
  );
};

export default ChatIcons;
