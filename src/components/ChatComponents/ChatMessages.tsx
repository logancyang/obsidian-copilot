import ChatSingleMessage from "@/components/ChatComponents/ChatSingleMessage";
import { ChatMessage } from "@/sharedState";
import { App } from "obsidian";
import React, { useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  app: App;
  onInsertAtCursor: (message: string) => void;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatHistory,
  currentAiMessage,
  loading,
  app,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
}) => {
  const [loadingDots, setLoadingDots] = useState("");

  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector(".chat-messages");
    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
  };

  useEffect(() => {
    if (!loading) {
      scrollToBottom();
    }
  }, [loading]);

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
            <ChatSingleMessage
              key={index}
              message={message}
              app={app}
              isStreaming={false}
              onInsertAtCursor={() => {
                onInsertAtCursor(message.message);
              }}
              onRegenerate={() => onRegenerate(index)}
              onEdit={(newMessage) => onEdit(index, newMessage)}
            />
          )
      )}
      {(currentAiMessage || loading) && (
        <ChatSingleMessage
          key={`ai_message_${currentAiMessage}`}
          message={{
            sender: "AI",
            message: currentAiMessage || loadingDots,
            isVisible: true,
            timestamp: null,
          }}
          app={app}
          isStreaming={true}
        />
      )}
    </div>
  );
};

export default ChatMessages;
