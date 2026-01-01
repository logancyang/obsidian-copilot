import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Base message interface that all message types should extend
 */
export interface BaseMessage {
  /** Unique identifier for the message */
  id?: string;
  /** Message sender identifier */
  sender: string;
  /** Whether this message is visible */
  isVisible: boolean;
}

/**
 * Props for individual message rendering
 */
export interface MessageRenderProps<T extends BaseMessage> {
  /** The message to render */
  message: T;
  /** Index in the message list */
  index: number;
  /** Whether this is the last visible message */
  isLastMessage: boolean;
  /** Whether this message is currently streaming */
  isStreaming: boolean;
}

/**
 * Props for the streaming message component
 */
export interface StreamingMessageProps {
  /** Current content being streamed */
  content: string;
  /** Optional loading message to display */
  loadingMessage?: string;
}

/**
 * Props for the MessageList component
 */
export interface MessageListProps<T extends BaseMessage> {
  /** Array of messages to display */
  messages: T[];

  /** Render function for each message */
  renderMessage: (props: MessageRenderProps<T>) => React.ReactNode;

  /** Optional streaming message content (when AI is generating) */
  streamingContent?: string;

  /** Render function for the streaming message */
  renderStreamingMessage?: (props: StreamingMessageProps) => React.ReactNode;

  /** Whether currently loading/generating */
  loading?: boolean;

  /** Optional loading message */
  loadingMessage?: string;

  /** Sender identifier for user messages (used for scroll behavior) */
  userSender?: string;

  /** Optional empty state component */
  emptyState?: React.ReactNode;

  /** Additional CSS classes for the container */
  className?: string;

  /** Additional CSS classes for the scroll container */
  scrollContainerClassName?: string;

  /** Test ID for the container */
  testId?: string;
}

/**
 * Custom hook for message list scrolling behavior
 */
function useMessageListScrolling<T extends BaseMessage>({
  messages,
  userSender = "user",
}: {
  messages: T[];
  userSender?: string;
}) {
  const [containerMinHeight, setContainerMinHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  /**
   * Generate a consistent key for each message
   */
  const getMessageKey = useCallback((message: T, index: number): string => {
    return `message-${message.id || index}`;
  }, []);

  /**
   * Calculate dynamic min-height based on container and last user message
   */
  const calculateDynamicMinHeight = useCallback(() => {
    if (!scrollContainerRef.current) return 0;

    const messagesContainer = scrollContainerRef.current;
    const containerHeight = messagesContainer.clientHeight;

    // Find the last user message
    const lastUserMessageIndex = messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.isVisible && msg.sender.toLowerCase() === userSender.toLowerCase())
      .pop()?.idx;

    let lastUserMessageHeight = 0;

    if (lastUserMessageIndex !== undefined) {
      const lastUserMessageKey = getMessageKey(
        messages[lastUserMessageIndex],
        lastUserMessageIndex
      );
      const lastUserMessageElement = messagesContainer.querySelector(
        `[data-message-key="${lastUserMessageKey}"]`
      );

      if (lastUserMessageElement) {
        lastUserMessageHeight = lastUserMessageElement.getBoundingClientRect().height;
      } else {
        // Fallback estimation
        lastUserMessageHeight = 80;
      }
    }

    return Math.max(100, containerHeight - lastUserMessageHeight);
  }, [messages, userSender, getMessageKey]);

  /**
   * Callback ref for the scroll container
   */
  const scrollContainerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === scrollContainerRef.current) {
        return;
      }

      // Cleanup previous observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      scrollContainerRef.current = node;

      if (node) {
        const calculatedMinHeight = calculateDynamicMinHeight();
        setContainerMinHeight(calculatedMinHeight);

        const resizeObserver = new ResizeObserver(() => {
          if (scrollContainerRef.current) {
            const newCalculatedMinHeight = calculateDynamicMinHeight();
            setContainerMinHeight(newCalculatedMinHeight);
          }
        });

        resizeObserver.observe(node);
        resizeObserverRef.current = resizeObserver;
      }
    },
    [calculateDynamicMinHeight]
  );

  /**
   * Scroll to bottom of the container
   */
  const scrollToBottom = useCallback((behavior: "smooth" | "instant" = "smooth") => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  // Recalculate min-height when messages change
  useEffect(() => {
    if (scrollContainerRef.current && messages.length > 0) {
      const newCalculatedMinHeight = calculateDynamicMinHeight();
      setContainerMinHeight(newCalculatedMinHeight);
    }
  }, [messages, calculateDynamicMinHeight]);

  // Cleanup ResizeObserver on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom("instant");
  }, [scrollToBottom]);

  // Scroll to bottom when user messages are added
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.sender.toLowerCase() === userSender.toLowerCase()) {
        scrollToBottom();
      }
    }
  }, [messages.length, messages, userSender, scrollToBottom]);

  return {
    containerMinHeight,
    scrollContainerCallbackRef,
    getMessageKey,
  };
}

/**
 * MessageList - A generic, reusable message list component
 *
 * This component provides a flexible message list that can be used
 * in various chat contexts with different message types and rendering.
 *
 * @example
 * ```tsx
 * <MessageList
 *   messages={chatHistory}
 *   renderMessage={({ message, index, isLastMessage }) => (
 *     <ChatSingleMessage
 *       message={message}
 *       app={app}
 *       isStreaming={false}
 *       onRegenerate={() => handleRegenerate(index)}
 *       onEdit={(newMessage) => handleEdit(index, newMessage)}
 *       onDelete={() => handleDelete(index)}
 *     />
 *   )}
 *   streamingContent={currentAiMessage}
 *   renderStreamingMessage={({ content }) => (
 *     <ChatSingleMessage
 *       message={{ sender: "AI", message: content, isVisible: true }}
 *       app={app}
 *       isStreaming={true}
 *     />
 *   )}
 *   loading={isLoading}
 *   emptyState={<EmptyState />}
 * />
 * ```
 */
function MessageListInner<T extends BaseMessage>({
  messages,
  renderMessage,
  streamingContent,
  renderStreamingMessage,
  loading = false,
  loadingMessage,
  userSender = "user",
  emptyState,
  className,
  scrollContainerClassName,
  testId = "message-list",
}: MessageListProps<T>) {
  const visibleMessages = messages.filter((m) => m.isVisible);

  const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useMessageListScrolling(
    {
      messages,
      userSender,
    }
  );

  // Show empty state if no messages and not streaming
  if (!visibleMessages.length && !streamingContent && !loading) {
    if (emptyState) {
      return (
        <div
          className={cn("tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto", className)}
        >
          {emptyState}
        </div>
      );
    }
    return null;
  }

  return (
    <div className={cn("tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden", className)}>
      <div
        ref={scrollContainerCallbackRef}
        data-testid={testId}
        className={cn(
          "tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]",
          scrollContainerClassName
        )}
      >
        {visibleMessages.map((message, index) => {
          const isLastMessage = index === visibleMessages.length - 1;
          const isUserMessage = message.sender.toLowerCase() === userSender.toLowerCase();
          // Only apply min-height to non-user messages that are last
          const shouldApplyMinHeight = isLastMessage && !isUserMessage;

          return (
            <div
              key={getMessageKey(message, index)}
              data-message-key={getMessageKey(message, index)}
              className="tw-w-full"
              style={{
                minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
              }}
            >
              {renderMessage({
                message,
                index,
                isLastMessage,
                isStreaming: false,
              })}
            </div>
          );
        })}

        {/* Streaming message */}
        {(streamingContent || loading) && renderStreamingMessage && (
          <div
            className="tw-w-full"
            style={{
              minHeight: `${containerMinHeight}px`,
            }}
          >
            {renderStreamingMessage({
              content: streamingContent || "",
              loadingMessage,
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Set displayName on the inner component for debugging
MessageListInner.displayName = "MessageList";

/**
 * Memoized MessageList component
 *
 * Note: Due to TypeScript limitations with generic components and memo,
 * we export the inner component wrapped in memo. For proper typing,
 * callers may need to use type assertions in some cases.
 */
export const MessageList = memo(MessageListInner) as typeof MessageListInner;

export default MessageList;
