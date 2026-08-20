import { BottomLoadingIndicator } from "@/components/chat-components/BottomLoadingIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  /** Stable ID for streaming message, shared with final persisted message */
  streamingMessageId?: string | null;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
}

/**
 * Whether the chat view has nothing to show: no visible message and no
 * in-flight AI response. `ChatMessages` swaps to its suggested-prompts branch
 * on exactly this condition and `Chat` gates the Agent mode banner on it, so
 * the two surfaces cannot drift apart over what counts as an empty chat.
 *
 * @param chatHistory Messages for the active chat, including ones flagged invisible.
 * @param currentAiMessage Text streaming in from the AI right now, empty when nothing is streaming.
 */
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
    onRegenerate,
    onEdit,
    onDelete,
  }: ChatMessagesProps) => {
    // Chat scrolling behavior
    const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
      chatHistory,
    });

    if (isChatEmpty(chatHistory, currentAiMessage)) {
      // Height comes from the content, not the container: `Chat` centers the
      // Agent Chat banner in the space this branch leaves free, so filling the
      // column here would push that banner back to the top.
      return (
        <div className="tw-flex tw-w-full tw-flex-col tw-gap-2">
          {loading && <BottomLoadingIndicator label={loadingMessage} />}
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <div
          ref={scrollContainerCallbackRef}
          data-testid="chat-messages"
          className="tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
        >
          {chatHistory.map((message, index) => {
            const visibleMessages = chatHistory.filter((m) => m.isVisible);
            const isLastMessage = index === visibleMessages.length - 1;
            // Only apply min-height to AI messages that are last
            const shouldApplyMinHeight = isLastMessage && message.sender !== USER_SENDER;

            return (
              message.isVisible && (
                <div
                  key={getMessageKey(message, index)}
                  data-message-key={getMessageKey(message, index)}
                  className="tw-w-full"
                  style={{
                    minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
                  }}
                >
                  <ChatSingleMessage
                    message={message}
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
            <div
              className="tw-w-full"
              style={{
                minHeight: `${containerMinHeight}px`,
              }}
            >
              <ChatSingleMessage
                key={streamingMessageId ?? "ai_message_streaming"}
                message={{
                  id: streamingMessageId ?? undefined,
                  sender: "AI",
                  message: currentAiMessage,
                  isVisible: true,
                  timestamp: null,
                }}
                app={app}
                isStreaming={true}
                onDelete={() => {}}
              />
            </div>
          ) : loading ? (
            <div
              className="tw-w-full"
              style={{
                minHeight: `${containerMinHeight}px`,
              }}
            >
              <BottomLoadingIndicator label={loadingMessage} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
