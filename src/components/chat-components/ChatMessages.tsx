import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { SuggestedPrompts } from "@/components/chat-components/SuggestedPrompts";
import { USER_SENDER } from "@/constants";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useEffect, useState, useRef, useCallback } from "react";

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
    const [containerMinHeight, setContainerMinHeight] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    const settings = useSettingsValue();

    const scrollToBottom = (behavior: "smooth" | "instant" = "smooth") => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior,
        });
      }
    };

    // Store ResizeObserver reference to clean it up
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    // Calculate min-height based on actual last user message size
    const calculateDynamicMinHeight = useCallback(() => {
      if (!scrollContainerRef.current) return 0;

      const messagesContainer = scrollContainerRef.current;
      const containerHeight = messagesContainer.clientHeight;

      // Find the last user message element to measure its actual height
      const lastUserMessageIndex = chatHistory
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) => msg.isVisible && msg.sender === USER_SENDER)
        .pop()?.idx;

      let lastUserMessageHeight = 0;

      if (lastUserMessageIndex !== undefined) {
        // Try to find the corresponding DOM element
        const lastUserMessageKey = `message-${chatHistory[lastUserMessageIndex].timestamp?.epoch || lastUserMessageIndex}`;
        const lastUserMessageElement = messagesContainer.querySelector(
          `[data-message-key="${lastUserMessageKey}"]`
        );

        if (lastUserMessageElement) {
          lastUserMessageHeight = lastUserMessageElement.getBoundingClientRect().height;
        } else {
          // Fallback: estimate based on message length (rough approximation)
          const messageLength = chatHistory[lastUserMessageIndex].message.length;
          const estimatedLines = Math.ceil(messageLength / 80); // ~80 chars per line
          lastUserMessageHeight = Math.max(60, estimatedLines * 24); // ~24px per line + padding
        }
      }

      const minHeight = Math.max(100, containerHeight - lastUserMessageHeight);

      return minHeight;
    }, [chatHistory]);

    // Memoized callback ref that gets called only when the DOM element actually changes
    const scrollContainerCallbackRef = useCallback(
      (node: HTMLDivElement | null) => {
        // Only proceed if the node actually changed
        if (node === scrollContainerRef.current) {
          return; // Same node, nothing to do
        }

        // Clean up previous observer if it exists
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
          resizeObserverRef.current = null;
        }

        // Update the ref
        scrollContainerRef.current = node;

        if (node) {
          // Calculate initial height using dynamic measurement
          const calculatedMinHeight = calculateDynamicMinHeight();
          setContainerMinHeight(calculatedMinHeight);

          // Set up ResizeObserver on the messages container
          const resizeObserver = new ResizeObserver((entries) => {
            if (scrollContainerRef.current) {
              // Recalculate min-height dynamically based on current messages
              const newCalculatedMinHeight = calculateDynamicMinHeight();
              setContainerMinHeight(newCalculatedMinHeight);
            }
          });

          // Observe the messages container for size changes
          resizeObserver.observe(node);

          resizeObserverRef.current = resizeObserver;
        }
      },
      [calculateDynamicMinHeight]
    ); // Empty dependencies - this callback never changes

    // Scroll to bottom when component mounts (instant to avoid initial animation)
    useEffect(() => {
      scrollToBottom("instant");
    }, []);

    // Scroll to bottom when new messages are added
    useEffect(() => {
      scrollToBottom();
    }, [chatHistory.length]);

    // Recalculate min-height when chat history changes (new messages)
    useEffect(() => {
      if (scrollContainerRef.current && chatHistory.length > 0) {
        const newCalculatedMinHeight = calculateDynamicMinHeight();
        setContainerMinHeight(newCalculatedMinHeight);
      }
    }, [chatHistory, calculateDynamicMinHeight]);

    // Cleanup ResizeObserver on unmount
    useEffect(() => {
      return () => {
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
        }
      };
    }, []);

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
                  key={`message-${message.timestamp?.epoch || index}`}
                  data-message-key={`message-${message.timestamp?.epoch || index}`}
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
                    chatHistory={chatHistory}
                  />
                </div>
              )
            );
          })}
          {(currentAiMessage || loading) && (
            <div
              style={{
                minHeight: `${containerMinHeight}px`,
              }}
            >
              <ChatSingleMessage
                key="ai_message_streaming"
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
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
