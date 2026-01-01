import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { MessageList, MessageRenderProps, StreamingMessageProps } from "@/components/shared";
import { USER_SENDER } from "@/constants";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useCallback, useEffect, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  onReplaceChat: (prompt: string) => void;
  showHelperComponents: boolean;
}

/**
 * Extend ChatMessage to satisfy BaseMessage interface for MessageList
 */
type ChatMessageWithBase = ChatMessage & { sender: string; isVisible: boolean };

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
    onReplaceChat,
    showHelperComponents = true,
  }: ChatMessagesProps) => {
    const [loadingDots, setLoadingDots] = useState("");

    const settings = useSettingsValue();

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

    const getLoadingMessage = useCallback(() => {
      return loadingMessage ? `${loadingMessage} ${loadingDots}` : loadingDots;
    }, [loadingMessage, loadingDots]);

    /**
     * Render function for individual messages
     */
    const renderMessage = useCallback(
      ({ message, index }: MessageRenderProps<ChatMessageWithBase>) => {
        return (
          <ChatSingleMessage
            message={message}
            app={app}
            isStreaming={false}
            onRegenerate={() => onRegenerate(index)}
            onEdit={(newMessage) => onEdit(index, newMessage)}
            onDelete={() => onDelete(index)}
          />
        );
      },
      [app, onRegenerate, onEdit, onDelete]
    );

    /**
     * Render function for the streaming message
     */
    const renderStreamingMessage = useCallback(
      ({ content }: StreamingMessageProps) => {
        return (
          <ChatSingleMessage
            key="ai_message_streaming"
            message={{
              sender: "AI",
              message: content || getLoadingMessage(),
              isVisible: true,
              timestamp: null,
            }}
            app={app}
            isStreaming={true}
            onDelete={() => {}}
          />
        );
      },
      [app, getLoadingMessage]
    );

    /**
     * Empty state component with helper components
     */
    const emptyState = (
      <>
        {showHelperComponents && settings.showRelevantNotes && (
          <RelevantNotes defaultOpen={true} key="relevant-notes-before-chat" />
        )}
        {showHelperComponents && settings.showSuggestedPrompts && (
          <SuggestedPrompts onClick={onReplaceChat} />
        )}
      </>
    );

    // Show empty state directly if no messages and no streaming content
    if (
      !chatHistory.filter((message) => message.isVisible).length &&
      !currentAiMessage &&
      !loading
    ) {
      return (
        <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto">
          {emptyState}
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        {showHelperComponents && settings.showRelevantNotes && (
          <RelevantNotes className="tw-mb-4" defaultOpen={false} key="relevant-notes-in-chat" />
        )}
        <MessageList<ChatMessageWithBase>
          messages={chatHistory}
          renderMessage={renderMessage}
          streamingContent={currentAiMessage}
          renderStreamingMessage={renderStreamingMessage}
          loading={loading}
          loadingMessage={loadingMessage}
          userSender={USER_SENDER}
          testId="chat-messages"
        />
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
