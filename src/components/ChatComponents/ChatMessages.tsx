import ChatSingleMessage from '@/components/ChatComponents/ChatSingleMessage';
import { BotIcon } from '@/components/Icons';
import ReactMarkdown from '@/components/Markdown/MemoizedReactMarkdown';
import { ChatMessage } from '@/sharedState';
import React, { useEffect } from 'react';

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatHistory, currentAiMessage,
}) => {
  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector('.chat-messages');
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  };

  useEffect(() => {scrollToBottom()}, [chatHistory]);

  return (
    <div className="chat-messages">
      {chatHistory.map((message, index) => (
        <ChatSingleMessage key={index} message={message} />
      ))}
      {currentAiMessage && (
        <div className="message bot-message" key={`ai_message_${currentAiMessage}`}>
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
