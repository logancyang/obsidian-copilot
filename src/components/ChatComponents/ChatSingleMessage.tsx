import React, { useState } from 'react';
import { ChatMessage } from '@/sharedState';
import { USER_SENDER } from '@/constants';
import { UserIcon, BotIcon, CopyClipboardIcon, CheckIcon } from '@/components/Icons';
import ReactMarkdown from '@/components/Markdown/MemoizedReactMarkdown';


interface ChatSingleMessageProps {
  message: ChatMessage;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({ message }) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

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
    <div className='message-container'>
      <div
        className={`message ${
          message.sender === USER_SENDER ? "user-message" : "bot-message"
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
      <button onClick={copyToClipboard} className="copy-message-button">
        {isCopied ? <CheckIcon /> : <CopyClipboardIcon />}
      </button>
    </div>
  );
};

export default ChatSingleMessage;
