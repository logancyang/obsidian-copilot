import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { App } from "obsidian";
import React, { memo, useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  onInsertToChat: (prompt: string) => void;
  onReplaceChat: (prompt: string) => void;
  showHelperComponents: boolean;
}

const ChatMessages = memo(
  ({
    chatHistory,
    currentAiMessage,
    loading,
    loadingMessage,
    app,
    onRegenerate,
    onEdit,
    onDelete,
    onInsertToChat,
    onReplaceChat,
    showHelperComponents = true,
  }: ChatMessagesProps) => {
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
        <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto">
          {showHelperComponents && settings.showRelevantNotes && (
            <RelevantNotes
              onInsertToChat={onInsertToChat}
              defaultOpen={true}
              key="relevant-notes-before-chat"
            />
          )}
          {showHelperComponents && settings.showSuggestedPrompts && (
            <SuggestedPrompts onClick={onReplaceChat} />
          )}
        </div>
      );
    }

    const getLoadingMessage = () => {
      return loadingMessage ? `${loadingMessage} ${loadingDots}` : loadingDots;
    };

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        {showHelperComponents && settings.showRelevantNotes && (
          <RelevantNotes
            className="tw-mb-4"
            onInsertToChat={onInsertToChat}
            defaultOpen={false}
            key="relevant-notes-in-chat"
          />
        )}
        <div
          data-testid="chat-messages"
          className="tw-mt-auto tw-box-border tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
        >
          {chatHistory.map(
            (message, index) =>
              message.isVisible && (
                <ChatSingleMessage
                  key={index}
                  message={message}
                  app={app}
                  isStreaming={false}
                  onRegenerate={() => onRegenerate(index)}
                  onEdit={(newMessage) => onEdit(index, newMessage)}
                  onDelete={() => onDelete(index)}
                  chatHistory={chatHistory}
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
              chatHistory={chatHistory}
            />
          )}
        </div>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
