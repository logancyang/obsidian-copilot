import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";

const END_THRESHOLD_PX = 24;
const GLIDE_TIME_CONSTANT_MS = 60;

const distanceToEnd = (node: HTMLElement): number =>
  node.scrollHeight - node.clientHeight - node.scrollTop;

const isNearEnd = (node: HTMLElement): boolean => distanceToEnd(node) <= END_THRESHOLD_PX;

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
  const cancelGlideRef = useRef<(() => void) | null>(null);

  const getMessageKey = useCallback((message: ChatMessage, index: number): string => {
    return `message-${message.id || message.timestamp?.epoch || index}`;
  }, []);

  const stopGlide = useCallback(() => {
    cancelGlideRef.current?.();
    cancelGlideRef.current = null;
  }, []);

  const alignToEnd = useCallback(() => {
    stopGlide();
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
  }, [stopGlide]);

  // A streaming reply grows a line at a time, and jumping a full line per wrap reads as jitter; easing toward the end keeps the text gliding. https://github.com/Brevilabs/obsidian-copilot-private/issues/887
  const followEnd = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    if (
      distanceToEnd(node) > node.clientHeight ||
      node.win.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      alignToEnd();
      return;
    }
    if (cancelGlideRef.current) return;
    const win = node.win;
    let last: number | null = null;
    let frame = 0;
    const step = (now: number) => {
      const elapsed = now - (last ?? now - 16);
      last = now;
      const gap = distanceToEnd(node);
      if (!isFollowingRef.current || gap <= 1) {
        cancelGlideRef.current = null;
        if (isFollowingRef.current) alignToEnd();
        return;
      }
      node.scrollTop += Math.max(1, gap * (1 - Math.exp(-elapsed / GLIDE_TIME_CONSTANT_MS)));
      lastScrollTopRef.current = node.scrollTop;
      frame = win.requestAnimationFrame(step);
    };
    frame = win.requestAnimationFrame(step);
    cancelGlideRef.current = () => win.cancelAnimationFrame(frame);
  }, [alignToEnd]);

  const resumeFollowing = useCallback(() => {
    isFollowingRef.current = true;
    setIsScrollPaused(false);
  }, []);

  const scrollToEnd = useCallback(() => {
    resumeFollowing();
    alignToEnd();
  }, [resumeFollowing, alignToEnd]);

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
      stopGlide();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      scrollContainerRef.current = node;

      if (node) {
        const resizeObserver = new ResizeObserver(() => {
          // Markdown and images can grow after React commits the streaming message, and a
          // taller viewport can reach the end without firing a scroll event.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/277
          if (!isFollowingRef.current && !isNearEnd(node)) return;
          resumeFollowing();
          followEnd();
        });
        resizeObserver.observe(node);
        if (contentRef.current) resizeObserver.observe(contentRef.current);
        resizeObserverRef.current = resizeObserver;
      }
    },
    [stopGlide, resumeFollowing, followEnd]
  );

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (node === contentRef.current) return;
    if (contentRef.current) resizeObserverRef.current?.unobserve(contentRef.current);
    contentRef.current = node;
    if (node) resizeObserverRef.current?.observe(node);
  }, []);

  const hasOpenedRef = useRef(false);
  useLayoutEffect(() => {
    // An opened chat lands at its end at once; only later growth glides. https://github.com/Brevilabs/obsidian-copilot-private/issues/887
    if (!hasOpenedRef.current) {
      hasOpenedRef.current = true;
      alignToEnd();
    } else if (isFollowingRef.current) followEnd();
  }, [chatHistory, alignToEnd, followEnd]);

  useEffect(() => {
    return () => {
      stopGlide();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [stopGlide]);

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
