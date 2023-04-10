import React, { useEffect } from 'react';
import { ChatMessage } from '@/sharedState';
import ChatMessageComponent from '@/components/ChatComponents/ChatMessageComponent';
import ReactMarkdown from '@/components/Markdown/MemoizedReactMarkdown';
import { BotIcon } from '@/components/Icons';

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({ chatHistory, currentAiMessage }) => {
  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector('.chat-messages');
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  return (
    <div className="chat-messages">
      {chatHistory.map((message, index) => (
        <ChatMessageComponent key={index} message={message} />
      ))}
      {currentAiMessage && (
        <div className="message bot-message">
          <div className="message-icon">
            <BotIcon />
          </div>
          <div className="message-content">
            <ReactMarkdown>{currentAiMessage}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatMessages;
