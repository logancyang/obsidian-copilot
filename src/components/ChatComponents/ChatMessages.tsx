import ChatSingleMessage from "@/components/ChatComponents/ChatSingleMessage";
import { BotIcon } from "@/components/Icons";
import ReactMarkdown from "@/components/Markdown/MemoizedReactMarkdown";
import { ChatMessage } from "@/sharedState";
import { App } from "obsidian";
import React, { useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  app: App;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatHistory,
  currentAiMessage,
  loading,
  app,
}) => {
  const [loadingDots, setLoadingDots] = useState("");

  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector(".chat-messages");
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (loading) {
      intervalId = setInterval(() => {
        setLoadingDots((dots) => (dots.length < 6 ? dots + "." : ""));
      }, 200);
    } else {
      setLoadingDots("");
    }
    return () => clearInterval(intervalId);
  }, [loading]);

  return (
    <div className="chat-messages">
      {chatHistory.map(
        (message, index) =>
          message.isVisible && <ChatSingleMessage key={index} message={message} app={app} />
      )}
      {currentAiMessage ? (
        <div className="message bot-message" key={`ai_message_${currentAiMessage}`}>
          <div className="message-icon">
            <BotIcon />
          </div>
          <div className="message-content">
            <ReactMarkdown>{currentAiMessage}</ReactMarkdown>
          </div>
        </div>
      ) : (
        loading && (
          <div className="message bot-message" key={`ai_message_${currentAiMessage}`}>
            <div className="message-icon">
              <BotIcon />
            </div>
            <div className="message-content">
              <ReactMarkdown>{loadingDots}</ReactMarkdown>
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default ChatMessages;
