import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect } from "react";

interface UseChatScrollingOptions {
  chatHistory: ChatMessage[];
}

interface UseChatScrollingReturn {
  containerMinHeight: number;
  scrollContainerCallbackRef: (node: HTMLDivElement | null) => void;
  getMessageKey: (message: ChatMessage, index: number) => string;
}

export const useChatScrolling = ({
  chatHistory,
}: UseChatScrollingOptions): UseChatScrollingReturn => {
  const [containerMinHeight, setContainerMinHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const prevChatLengthRef = useRef<number>(0);

  // Generate consistent message key for DOM identification
  // Using message IDs is better, as in the case of a network disconnection, the timestamps of two messages could be identical.
  const getMessageKey = useCallback((message: ChatMessage, index: number): string => {
    return `message-${message.id || message.timestamp?.epoch || index}`;
  }, []);

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
      const lastUserMessageKey = getMessageKey(
        chatHistory[lastUserMessageIndex],
        lastUserMessageIndex
      );
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
  }, [chatHistory, getMessageKey]);

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
        const resizeObserver = new ResizeObserver(() => {
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
  );

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

  // Scroll to bottom function
  const scrollToBottom = useCallback((behavior: "smooth" | "instant" = "smooth") => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  // Scroll to bottom when component mounts (instant to avoid initial animation)
  useEffect(() => {
    scrollToBottom("instant");
  }, [scrollToBottom]);

  // Scroll to bottom only when user messages are added
  useEffect(() => {
    // Reset ref if chat history shrinks (new chat, deleted messages)
    if (chatHistory.length < prevChatLengthRef.current) {
      prevChatLengthRef.current = chatHistory.length;
    }

    if (chatHistory.length > 0) {
      // Check if a new message was added
      const hasNewMessage = chatHistory.length > prevChatLengthRef.current;

      if (hasNewMessage) {
        const lastMessage = chatHistory[chatHistory.length - 1];
        // Only scroll for user messages
        if (lastMessage && lastMessage.sender === USER_SENDER) {
          scrollToBottom();
        }
        // Update the ref
        prevChatLengthRef.current = chatHistory.length;
      }
    }
  }, [chatHistory, scrollToBottom]);

  return {
    containerMinHeight,
    scrollContainerCallbackRef,
    getMessageKey,
  };
};
