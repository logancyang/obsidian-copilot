import { USER_SENDER } from "@/constants";
import type { ChatMessageView } from "@/types/message";
import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";

const END_THRESHOLD_PX = 24;

const isNearEnd = (node: HTMLElement): boolean =>
  node.scrollHeight - node.clientHeight - node.scrollTop <= END_THRESHOLD_PX;

interface UseChatScrollingOptions {
  chatHistory: ChatMessageView[];
}

interface UseChatScrollingReturn {
  containerMinHeight: number;
  scrollContainerCallbackRef: (node: HTMLDivElement | null) => void;
  contentCallbackRef: (node: HTMLDivElement | null) => void;
  onScroll: () => void;
  isScrollPaused: boolean;
  scrollToEnd: () => void;
  getMessageKey: (message: ChatMessageView, index: number) => string;
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

  const getMessageKey = useCallback((message: ChatMessageView, index: number): string => {
    return `message-${message.id || message.timestamp?.epoch || index}`;
  }, []);

  const calculateDynamicMinHeight = useCallback(() => {
    if (!scrollContainerRef.current) return 0;

    const messagesContainer = scrollContainerRef.current;
    const containerHeight = messagesContainer.clientHeight;

    const history = chatHistoryRef.current;
    const lastUserMessageIndex = history
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.isVisible && msg.sender === USER_SENDER)
      .pop()?.idx;

    let lastUserMessageHeight = 0;

    if (lastUserMessageIndex !== undefined) {
      const lastUserMessageKey = getMessageKey(history[lastUserMessageIndex], lastUserMessageIndex);
      const lastUserMessageElement = messagesContainer.querySelector(
        `[data-message-key="${lastUserMessageKey}"]`
      );

      if (lastUserMessageElement) {
        lastUserMessageHeight = lastUserMessageElement.getBoundingClientRect().height;
      } else {
        const messageLength = history[lastUserMessageIndex].message.length;
        const estimatedLines = Math.ceil(messageLength / 80);
        lastUserMessageHeight = Math.max(60, estimatedLines * 24);
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
    if (isNearEnd(node)) {
      isFollowingRef.current = true;
      setIsScrollPaused(false);
    } else if (node.scrollTop < lastScrollTopRef.current) {
      isFollowingRef.current = false;
      setIsScrollPaused(true);
    }
    lastScrollTopRef.current = node.scrollTop;
  }, []);

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
          // Markdown and images can grow after React commits the streaming message, and a
          // taller viewport can reach the end without firing a scroll event.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/277
          if (isFollowingRef.current || isNearEnd(node)) scrollToEnd();
        });
        resizeObserver.observe(node);
        if (contentRef.current) resizeObserver.observe(contentRef.current);
        resizeObserverRef.current = resizeObserver;
      }
    },
    [calculateDynamicMinHeight, scrollToEnd]
  );

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (node === contentRef.current) return;
    if (contentRef.current) resizeObserverRef.current?.unobserve(contentRef.current);
    contentRef.current = node;
    if (node) resizeObserverRef.current?.observe(node);
  }, []);

  useLayoutEffect(() => {
    if (scrollContainerRef.current && chatHistory.length > 0) {
      const newCalculatedMinHeight = calculateDynamicMinHeight();
      setContainerMinHeight(newCalculatedMinHeight);
    }
    if (isFollowingRef.current) alignToEnd();
  }, [chatHistory, calculateDynamicMinHeight, alignToEnd]);

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

  const lastSeenUserMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let latestUserMessage: ChatMessageView | undefined;
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
