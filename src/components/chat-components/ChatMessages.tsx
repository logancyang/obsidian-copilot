import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { App } from "obsidian";
import React, { useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onInsertAtCursor: (message: string) => void;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  onInsertToChat: (prompt: string) => void;
  onReplaceChat: (prompt: string) => void;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chatHistory,
  currentAiMessage,
  loading,
  loadingMessage,
  app,
  onInsertAtCursor,
  onRegenerate,
  onEdit,
  onDelete,
  onInsertToChat,
  onReplaceChat,
}) => {
  const [loadingDots, setLoadingDots] = useState("");

  const settings = useSettingsValue();
  const scrollToBottom = () => {
    const chatMessagesContainer = document.querySelector("[data-testid='chat-messages']");
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
      <div className="flex flex-col gap-4 overflow-y-auto w-full h-full p-2">
        {settings.showRelevantNotes && (
          <RelevantNotes
            onInsertToChat={onInsertToChat}
            defaultOpen={true}
            key="relevant-notes-before-chat"
          />
        )}
        {settings.showSuggestedPrompts && <SuggestedPrompts onClick={onReplaceChat} />}
      </div>
    );
  }

  const getLoadingMessage = () => {
    return loadingMessage ? `${loadingMessage} ${loadingDots}` : loadingDots;
  };

  return (
    <div
      data-testid="chat-messages"
      className="flex flex-col items-start justify-start flex-1 overflow-y-auto p-2 w-full break-words text-[calc(var(--font-text-size)_-_2px)] box-border scroll-smooth mt-auto select-text"
    >
      {settings.showRelevantNotes && (
        <RelevantNotes
          className="mb-4"
          onInsertToChat={onInsertToChat}
          defaultOpen={false}
          key="relevant-notes-in-chat"
        />
      )}
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
