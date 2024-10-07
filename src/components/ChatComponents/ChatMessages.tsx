import { ChainType } from "@/chainFactory";
import ChatSingleMessage from "@/components/ChatComponents/ChatSingleMessage";
import { SuggestedPrompts } from "@/components/ChatComponents/SuggestedPrompts";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { App } from "obsidian";
import React, { useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY;
  currentChain: ChainType;
  onInsertAtCursor: (message: string) => void;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  onSelectSuggestedPrompt: (prompt: string) => void;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatHistory,
  currentAiMessage,
  loading,
  currentChain,
  indexVaultToVectorStore,
  loadingMessage,
  app,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
  onDelete,
  onSelectSuggestedPrompt,
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

  if (!chatHistory.filter((message) => message.isVisible).length && !currentAiMessage) {
    return (
      <div className="chat-messages">
        <SuggestedPrompts
          chainType={currentChain}
          indexVaultToVectorStore={indexVaultToVectorStore}
          onClick={onSelectSuggestedPrompt}
        />
      </div>
    );
  }

  const getLoadingMessage = () => {
    return loadingMessage ? `${loadingMessage} ${loadingDots}` : loadingDots;
  };

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
              onDelete={() => onDelete(index)}
            />
          )
      )}
      {(currentAiMessage || loading) && (
        <ChatSingleMessage
          key={`ai_message_${currentAiMessage}`}
          message={{
            sender: "AI",
            message: currentAiMessage || getLoadingMessage(),
            isVisible: true,
            timestamp: null,
          }}
          app={app}
          isStreaming={true}
          onDelete={() => {}}
        />
      )}
    </div>
  );
};

export default ChatMessages;
