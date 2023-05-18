import { BotIcon, CheckIcon, CopyClipboardIcon, UserIcon } from '@/components/Icons';
import ReactMarkdown from '@/components/Markdown/MemoizedReactMarkdown';
import { USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import React, { useState } from 'react';


interface ChatSingleMessageProps {
  message: ChatMessage;
  editMessage: (newMessage: string, newSender: string) => void;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  editMessage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedMessage, setEditedMessage] = useState(message.message);
  const [editedSender, setEditedSender] = useState(message.sender);
  const [isCopied, setIsCopied] = useState(false);

  const handleEditButtonClick = () => {
    setIsEditing(true);
  };

  const handleSaveButtonClick = () => {
    editMessage(editedMessage, editedSender);
    setIsEditing(false);
  };

  const handleCancelButtonClick = () => {
    setIsEditing(false);
    setEditedMessage(message.message);
    setEditedSender(message.sender);
  };

  const handleDeleteButtonClick = () => {
    editMessage('', '');
  };

  const handleEditedMessageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setEditedMessage(event.target.value);
  };

  const handleEditedSenderChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    setEditedSender(event.target.value);
  };

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(message.message).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    });
  };

  return (
    <div className="message-container">
      {isEditing ? (
        <>
          <input
            type="text"
            value={editedMessage}
            onChange={handleEditedMessageChange}
          />
          <select value={editedSender} onChange={handleEditedSenderChange}>
            <option value="user">User</option>
            <option value="ai">AI</option>
          </select>
          <button onClick={handleSaveButtonClick}>Save</button>
          <button onClick={handleCancelButtonClick}>Cancel</button>
        </>
      ) : (
        <>
          <div
            className={`message ${
              message.sender === USER_SENDER ? 'user-message' : 'bot-message'
            }`}
          >
            <div className="message-icon">
              {message.sender === USER_SENDER ? <UserIcon /> : <BotIcon />}
            </div>
            <div className="message-content">
              {message.sender === USER_SENDER ? (
                <span>{message.message}</span>
              ) : (
                <ReactMarkdown>{message.message}</ReactMarkdown>
              )}
            </div>
          </div>
          <div className="message-buttons">
            <button onClick={handleEditButtonClick} className="edit-message-button">
              Edit
            </button>
            <button onClick={handleDeleteButtonClick} className="delete-message-button">
              Delete
            </button>
            <button onClick={copyToClipboard} className="copy-message-button">
              {isCopied ? <CheckIcon /> : <CopyClipboardIcon />}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatSingleMessage;