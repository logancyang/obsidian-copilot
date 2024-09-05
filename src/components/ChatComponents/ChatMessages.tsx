import ChatSingleMessage from "@/components/ChatComponents/ChatSingleMessage";
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
  }, [chatHistory, currentAiMessage]);

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
          message.isVisible && (
            <ChatSingleMessage key={index} message={message} app={app} isStreaming={false} />
          )
      )}
      {(currentAiMessage || loading) && (
        <ChatSingleMessage
          key={`ai_message_${currentAiMessage}`}
          message={{
            sender: "AI",
            message: currentAiMessage || loadingDots,
            isVisible: true,
          }}
          app={app}
          isStreaming={true}
        />
      )}
    </div>
  );
};

export default ChatMessages;
