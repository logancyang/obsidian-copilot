import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { useSmoothedText } from "@/hooks/useSmoothedText";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo } from "react";

// The agent's reasoning marker is metadata the message parses, not reply text, so pacing it would hide the reasoning indicator. https://github.com/Brevilabs/obsidian-copilot-private/issues/886
const LEADING_REASONING_MARKER = /^<!--AGENT_REASONING:\w+:\d+:.+?-->/;

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  streamingMessageId?: string | null;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  sourcePath?: string;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
}

export function isChatEmpty(chatHistory: ChatMessage[], currentAiMessage: string): boolean {
  return !chatHistory.some((message) => message.isVisible) && !currentAiMessage;
}

const ChatMessages = memo(
  ({
    chatHistory,
    currentAiMessage,
    streamingMessageId,
    loading,
    loadingMessage,
    app,
    sourcePath = "",
    onRegenerate,
    onEdit,
    onDelete,
  }: ChatMessagesProps) => {
    const {
      scrollContainerCallbackRef,
      contentCallbackRef,
      onScroll,
      isScrollPaused,
      scrollToEnd,
      getMessageKey,
    } = useChatScrolling({ chatHistory });
    const reasoningMarker = LEADING_REASONING_MARKER.exec(currentAiMessage)?.[0] ?? "";
    const shownReply = useSmoothedText(currentAiMessage.slice(reasoningMarker.length), true);

    if (isChatEmpty(chatHistory, currentAiMessage)) {
      return (
        <div className="tw-flex tw-w-full tw-flex-col tw-gap-2">
          {loading && <BottomLoadingIndicator label={loadingMessage} />}
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <ChatTranscriptViewport
          scrollContainerRef={scrollContainerCallbackRef}
          contentRef={contentCallbackRef}
          onScroll={onScroll}
          isScrollPaused={isScrollPaused}
          scrollToEnd={scrollToEnd}
        >
          {chatHistory.map((message, index) => {
            return (
              message.isVisible && (
                <div key={getMessageKey(message, index)} className="tw-w-full">
                  <ChatSingleMessage
                    message={message}
                    sourcePath={sourcePath}
                    app={app}
                    isStreaming={false}
                    onRegenerate={() => onRegenerate(index)}
                    onEdit={(newMessage) => onEdit(index, newMessage)}
                    onDelete={() => onDelete(index)}
                  />
                </div>
              )
            );
          })}
          {currentAiMessage ? (
            <div className="tw-w-full">
              <ChatSingleMessage
                key={streamingMessageId ?? "ai_message_streaming"}
                message={{
                  id: streamingMessageId ?? undefined,
                  sender: "AI",
                  message: reasoningMarker + shownReply,
                  isVisible: true,
                  timestamp: null,
                }}
                app={app}
                isStreaming={true}
                onDelete={() => {}}
              />
            </div>
          ) : loading ? (
            <div className="tw-w-full">
              <BottomLoadingIndicator label={loadingMessage} />
            </div>
          ) : null}
        </ChatTranscriptViewport>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
