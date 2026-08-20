import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect } from "react";

interface UseChatScrollingOptions {
  chatHistory: ChatMessage[];
  /**
   * True while a response is streaming. `jumpToLatest` only keeps following
   * new content while this is set, so follow mode can never outlive the turn
   * that the user opted into.
   */
  isStreaming?: boolean;
}

interface UseChatScrollingReturn {
  containerMinHeight: number;
  scrollContainerCallbackRef: (node: HTMLDivElement | null) => void;
  /**
   * Attach to the wrapper around the message content inside the scroll
   * container. Content growth (streaming, image loads) changes this element's
   * height without firing scroll events, so the hook observes it to keep
   * `isAtBottom` truthful.
   */
  contentCallbackRef: (node: HTMLDivElement | null) => void;
  getMessageKey: (message: ChatMessage, index: number) => string;
  /** True while the viewport rests within a small threshold of the newest message. */
  isAtBottom: boolean;
  /**
   * Scrolls to the newest message. While a response is streaming, keeps
   * following new content until the user scrolls up or the turn ends —
   * follow is strictly opt-in per click, so it never becomes the always-on
   * auto-follow that upstream declined in
   * https://github.com/logancyang/obsidian-copilot/issues/829.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/329
   */
  jumpToLatest: () => void;
  /**
   * Scrolls the message list by a wheel delta. Lets overlays floating above
   * the list (the scroll-to-bottom button) forward wheel events so hovering
   * them doesn't trap scrolling.
   */
  scrollBy: (deltaY: number) => void;
}

// Tolerance below which the viewport still counts as "at the bottom", so
// sub-pixel rounding and momentum-scroll overshoot don't flicker the
// scroll-to-bottom affordance (same threshold as QuickAskPanel's pin logic).
const AT_BOTTOM_THRESHOLD_PX = 24;

export const useChatScrolling = ({
  chatHistory,
  isStreaming = false,
}: UseChatScrollingOptions): UseChatScrollingReturn => {
  const [containerMinHeight, setContainerMinHeight] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentResizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollListenerCleanupRef = useRef<(() => void) | null>(null);
  const pendingScrollFrameRef = useRef<{ win: Window; id: number } | null>(null);
  // Follow mode entered by jumpToLatest during a stream; see the interface
  // JSDoc. lastScrollTopRef feeds the synchronous upward-scroll detection.
  const followStreamRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

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

  // Recompute whether the viewport is resting at the newest message. React
  // bails out of re-rendering when the boolean hasn't changed.
  const updateIsAtBottom = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    setIsAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight <= AT_BOTTOM_THRESHOLD_PX);
  }, []);

  // Coalesce scroll events into one at-bottom check per animation frame.
  // Obsidian popouts render in their own window, so the frame must come from
  // the container's owner window, not the main window's scheduler.
  const scheduleIsAtBottomCheck = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node || pendingScrollFrameRef.current) return;
    const win = node.win ?? window;
    const id = win.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null;
      updateIsAtBottom();
    });
    pendingScrollFrameRef.current = { win, id };
  }, [updateIsAtBottom]);

  // Upward-scroll detection must run synchronously in the scroll handler, not
  // in the coalesced frame: a content resize can re-push to the bottom in the
  // same frame, and a deferred check would then read downward movement and
  // keep follow mode alive against the user's intent. Follow-driven scrolls
  // only ever move down, so a shrinking scrollTop is a reliable user signal.
  // DESIGN NOTE: browser clamps (content shrink, pane growth reducing the max
  // scroll offset) also land here and clear follow. Evaluated and accepted:
  // the misfire only stops auto-follow — one extra click recovers it — while
  // distinguishing true input intent (wheel/touch/pointer tracking) was
  // rejected as compensating complexity with worse race behavior than this
  // conservative heuristic. If a future review flags this again, point them
  // at this note.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/329
  const handleScroll = useCallback(() => {
    const node = scrollContainerRef.current;
    if (node) {
      if (node.scrollTop < lastScrollTopRef.current) {
        followStreamRef.current = false;
      }
      lastScrollTopRef.current = node.scrollTop;
    }
    scheduleIsAtBottomCheck();
  }, [scheduleIsAtBottomCheck]);

  const detachScrollTracking = useCallback(() => {
    scrollListenerCleanupRef.current?.();
    scrollListenerCleanupRef.current = null;
    if (pendingScrollFrameRef.current) {
      pendingScrollFrameRef.current.win.cancelAnimationFrame(pendingScrollFrameRef.current.id);
      pendingScrollFrameRef.current = null;
    }
  }, []);

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
      detachScrollTracking();

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
          // Pane resizes change clientHeight, which shifts the bottom-distance
          // math even when the content height is unchanged.
          updateIsAtBottom();
        });

        // Observe the messages container for size changes
        resizeObserver.observe(node);

        resizeObserverRef.current = resizeObserver;

        node.addEventListener("scroll", handleScroll, { passive: true });
        scrollListenerCleanupRef.current = () => node.removeEventListener("scroll", handleScroll);
        lastScrollTopRef.current = node.scrollTop;
        updateIsAtBottom();
      }
    },
    [calculateDynamicMinHeight, detachScrollTracking, handleScroll, updateIsAtBottom]
  );

  // Recalculate min-height when chat history changes (new messages)
  useEffect(() => {
    if (scrollContainerRef.current && chatHistory.length > 0) {
      const newCalculatedMinHeight = calculateDynamicMinHeight();
      setContainerMinHeight(newCalculatedMinHeight);
    }
  }, [chatHistory, calculateDynamicMinHeight]);

  // Scroll to bottom function
  const scrollToBottom = useCallback((behavior: "smooth" | "instant" = "smooth") => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  const jumpToLatest = useCallback(() => {
    followStreamRef.current = isStreamingRef.current;
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // A finished turn ends the follow the user opted into; the next stream
  // requires a fresh click.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/329
  useEffect(() => {
    if (!isStreaming) {
      followStreamRef.current = false;
    }
  }, [isStreaming]);

  // Content growth (streaming appends, image/diagram loads) changes the
  // content element's height without firing scroll events, so the at-bottom
  // flag would go stale mid-generation and the scroll-to-bottom affordance
  // would never appear. Observing the content wrapper covers both React and
  // non-React growth; the container's own observer can't see it because a
  // fixed-height scroller keeps the same border-box while scrollHeight grows.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/329
  const contentCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === contentRef.current) {
        return;
      }
      if (contentResizeObserverRef.current) {
        contentResizeObserverRef.current.disconnect();
        contentResizeObserverRef.current = null;
      }
      contentRef.current = node;
      if (node) {
        const observer = new ResizeObserver(() => {
          // Re-target with "instant": re-starting a smooth animation on every
          // streamed token would keep resetting and never catch up.
          // https://github.com/logancyang/obsidian-copilot-preview/issues/329
          if (followStreamRef.current && isStreamingRef.current) {
            scrollToBottom("instant");
          }
          updateIsAtBottom();
        });
        observer.observe(node);
        contentResizeObserverRef.current = observer;
      }
    },
    [scrollToBottom, updateIsAtBottom]
  );

  // Cleanup ResizeObservers and scroll tracking on unmount
  useEffect(() => {
    return () => {
      detachScrollTracking();
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (contentResizeObserverRef.current) {
        contentResizeObserverRef.current.disconnect();
      }
    };
  }, [detachScrollTracking]);

  // "instant" bypasses the container's scroll-smooth so wheel steps don't
  // animate-lag behind the user's hand.
  const scrollBy = useCallback((deltaY: number) => {
    scrollContainerRef.current?.scrollBy({ top: deltaY, behavior: "instant" });
  }, []);

  // Scroll to bottom when component mounts (instant to avoid initial animation)
  useEffect(() => {
    scrollToBottom("instant");
  }, [scrollToBottom]);

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

    // First render: prime the ref so the on-mount instant scroll isn't
    // immediately followed by a smooth scroll.
    if (lastSeenUserMessageIdRef.current === undefined) {
      lastSeenUserMessageIdRef.current = latestId;
      return;
    }
    if (latestId && latestId !== lastSeenUserMessageIdRef.current) {
      lastSeenUserMessageIdRef.current = latestId;
      scrollToBottom();
    }
  }, [chatHistory, scrollToBottom]);

  return {
    containerMinHeight,
    scrollContainerCallbackRef,
    contentCallbackRef,
    getMessageKey,
    isAtBottom,
    jumpToLatest,
    scrollBy,
  };
};
