import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

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
  onReplaceChat: (prompt: string) => void;
  showHelperComponents: boolean;
  messagesRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Whether Vim navigation is enabled (passed from parent to avoid redundant settings reads) */
  vimNavigationEnabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
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
    onReplaceChat,
    showHelperComponents = true,
    messagesRef,
    vimNavigationEnabled = false,
    onKeyDown,
    onBlur,
  }: ChatMessagesProps) => {
    const [loadingDots, setLoadingDots] = useState("");

    const settings = useSettingsValue();

    // Chat scrolling behavior
    const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
      chatHistory,
    });

    // Combine scroll container ref with external messagesRef for vim navigation
    const combinedScrollContainerRef = useCallback(
      (node: HTMLDivElement | null) => {
        scrollContainerCallbackRef(node);
        if (messagesRef) {
          messagesRef.current = node;
        }
      },
      [scrollContainerCallbackRef, messagesRef]
    );

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

    // Find last visible message index with single reverse scan (O(n) with early exit)
    const { lastVisibleMessageIndex, hasVisibleMessages } = useMemo(() => {
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].isVisible) {
          return { lastVisibleMessageIndex: i, hasVisibleMessages: true };
        }
      }
      return { lastVisibleMessageIndex: -1, hasVisibleMessages: false };
    }, [chatHistory]);

    if (!hasVisibleMessages && !currentAiMessage) {
      return (
        <div
          ref={messagesRef}
          tabIndex={vimNavigationEnabled ? 0 : undefined}
          onKeyDown={vimNavigationEnabled ? onKeyDown : undefined}
          onBlur={vimNavigationEnabled ? onBlur : undefined}
          data-testid="chat-messages"
          className="copilot-messages-focusable tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto"
        >
          {showHelperComponents && settings.showRelevantNotes && (
            <RelevantNotes defaultOpen={true} key="relevant-notes-before-chat" />
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
          <RelevantNotes className="tw-mb-4" defaultOpen={false} key="relevant-notes-in-chat" />
        )}
        <div
          ref={combinedScrollContainerRef}
          tabIndex={vimNavigationEnabled ? 0 : undefined}
          onKeyDown={vimNavigationEnabled ? onKeyDown : undefined}
          onBlur={vimNavigationEnabled ? onBlur : undefined}
          data-testid="chat-messages"
          className="copilot-messages-focusable tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
        >
          {chatHistory.map((message, index) => {
            const isLastMessage = index === lastVisibleMessageIndex;
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
          {(currentAiMessage || loading) && (
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
                  message: currentAiMessage || getLoadingMessage(),
                  isVisible: true,
                  timestamp: null,
                }}
                app={app}
                isStreaming={true}
                onDelete={() => {}}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
