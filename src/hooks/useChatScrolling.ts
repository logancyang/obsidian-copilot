import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";

const END_THRESHOLD_PX = 24;

interface UseChatScrollingOptions {
  chatHistory: ChatMessage[];
}

interface UseChatScrollingReturn {
  containerMinHeight: number;
  scrollContainerCallbackRef: (node: HTMLDivElement | null) => void;
  contentCallbackRef: (node: HTMLDivElement | null) => void;
  onScroll: () => void;
  isScrollPaused: boolean;
  scrollToEnd: () => void;
  getMessageKey: (message: ChatMessage, index: number) => string;
}

export const useChatScrolling = ({
  chatHistory,
}: UseChatScrollingOptions): UseChatScrollingReturn => {
  const [containerMinHeight, setContainerMinHeight] = useState(0);
  const [isScrollPaused, setIsScrollPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const isFollowingRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;

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
    const history = chatHistoryRef.current;
    const lastUserMessageIndex = history
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.isVisible && msg.sender === USER_SENDER)
      .pop()?.idx;

    let lastUserMessageHeight = 0;

    if (lastUserMessageIndex !== undefined) {
      // Try to find the corresponding DOM element
      const lastUserMessageKey = getMessageKey(history[lastUserMessageIndex], lastUserMessageIndex);
      const lastUserMessageElement = messagesContainer.querySelector(
        `[data-message-key="${lastUserMessageKey}"]`
      );

      if (lastUserMessageElement) {
        lastUserMessageHeight = lastUserMessageElement.getBoundingClientRect().height;
      } else {
        // Fallback: estimate based on message length (rough approximation)
        const messageLength = history[lastUserMessageIndex].message.length;
        const estimatedLines = Math.ceil(messageLength / 80); // ~80 chars per line
        lastUserMessageHeight = Math.max(60, estimatedLines * 24); // ~24px per line + padding
      }
    }

    const minHeight = Math.max(100, containerHeight - lastUserMessageHeight);

    return minHeight;
  }, [getMessageKey]);

  const alignToEnd = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
  }, []);

  const scrollToEnd = useCallback(() => {
    isFollowingRef.current = true;
    setIsScrollPaused(false);
    alignToEnd();
  }, [alignToEnd]);

  const onScroll = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    // Readers can inspect older turns without losing their place during a growing response.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/277
    const distanceFromEnd = node.scrollHeight - node.clientHeight - node.scrollTop;
    if (distanceFromEnd <= END_THRESHOLD_PX) {
      isFollowingRef.current = true;
      setIsScrollPaused(false);
    } else if (node.scrollTop < lastScrollTopRef.current) {
      // Content can grow without a reader action, so only upward movement pauses following.
      isFollowingRef.current = false;
      setIsScrollPaused(true);
    }
    lastScrollTopRef.current = node.scrollTop;
  }, []);

  // Memoized callback ref that gets called only when the DOM element actually changes
  const scrollContainerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === scrollContainerRef.current) return;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      scrollContainerRef.current = node;

      if (node) {
        setContainerMinHeight(calculateDynamicMinHeight());
        const resizeObserver = new ResizeObserver(() => {
          setContainerMinHeight(calculateDynamicMinHeight());
          // Markdown and images can grow after React commits the streaming message.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/277
          if (isFollowingRef.current) alignToEnd();
        });
        resizeObserver.observe(node);
        if (contentRef.current) resizeObserver.observe(contentRef.current);
        resizeObserverRef.current = resizeObserver;
      }
    },
    [alignToEnd, calculateDynamicMinHeight]
  );

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (node === contentRef.current) return;
    if (contentRef.current) resizeObserverRef.current?.unobserve(contentRef.current);
    contentRef.current = node;
    if (node) resizeObserverRef.current?.observe(node);
  }, []);

  // Recalculate min-height when chat history changes (new messages)
  useLayoutEffect(() => {
    if (scrollContainerRef.current && chatHistory.length > 0) {
      const newCalculatedMinHeight = calculateDynamicMinHeight();
      setContainerMinHeight(newCalculatedMinHeight);
    }
    if (isFollowingRef.current) alignToEnd();
  }, [chatHistory, calculateDynamicMinHeight, alignToEnd]);

  // Cleanup ResizeObserver on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

  // Scroll only when a new user message is appended. Tracks the latest
  // visible user-message id rather than the trailing element's sender so the
  // scroll fires even when an AI placeholder is added in the same render
  // (e.g. Agent Mode appends user + assistant placeholder in one notify).
  const lastSeenUserMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let latestUserMessage: ChatMessage | undefined;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.isVisible && m.sender === USER_SENDER) {
        latestUserMessage = m;
        break;
      }
    }
    const latestId = latestUserMessage
      ? `${latestUserMessage.id ?? latestUserMessage.timestamp?.epoch ?? ""}`
      : undefined;

    // The layout effect has already aligned the initial transcript.
    if (lastSeenUserMessageIdRef.current === undefined) {
      lastSeenUserMessageIdRef.current = latestId;
      return;
    }
    if (latestId && latestId !== lastSeenUserMessageIdRef.current) {
      lastSeenUserMessageIdRef.current = latestId;
      scrollToEnd();
    }
  }, [chatHistory, scrollToEnd]);

  return {
    containerMinHeight,
    scrollContainerCallbackRef,
    contentCallbackRef,
    onScroll,
    isScrollPaused,
    scrollToEnd,
    getMessageKey,
  };
};
