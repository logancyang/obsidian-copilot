import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";

const END_THRESHOLD_PX = 24;

const isNearEnd = (node: HTMLElement): boolean =>
  node.scrollHeight - node.clientHeight - node.scrollTop <= END_THRESHOLD_PX;

interface UseChatScrollingOptions {
  chatHistory: ChatMessage[];
}

interface UseChatScrollingReturn {
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
  const [isScrollPaused, setIsScrollPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const isFollowingRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const getMessageKey = useCallback((message: ChatMessage, index: number): string => {
    return `message-${message.id || message.timestamp?.epoch || index}`;
  }, []);

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
        const resizeObserver = new ResizeObserver(() => {
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
    [scrollToEnd]
  );

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (node === contentRef.current) return;
    if (contentRef.current) resizeObserverRef.current?.unobserve(contentRef.current);
    contentRef.current = node;
    if (node) resizeObserverRef.current?.observe(node);
  }, []);

  useLayoutEffect(() => {
    if (isFollowingRef.current) alignToEnd();
  }, [chatHistory, alignToEnd]);

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

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
    scrollContainerCallbackRef,
    contentCallbackRef,
    onScroll,
    isScrollPaused,
    scrollToEnd,
    getMessageKey,
  };
};
