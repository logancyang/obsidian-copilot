import { AI_SENDER, USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { ChatMessage } from "@/types/message";
import { act, render, renderHook, screen } from "@testing-library/react";
import React, { useCallback } from "react";

const CHAT_HISTORY: ChatMessage[] = [
  {
    id: "prompt",
    sender: USER_SENDER,
    message: "A long prompt",
    timestamp: null,
    isVisible: true,
  },
  {
    id: "response",
    sender: AI_SENDER,
    message: "A short response",
    timestamp: null,
    isVisible: true,
  },
];

let resizeCallback: ResizeObserverCallback;
let observedTargets = new Map<Element, ResizeObserverCallback>();
const observe = jest.fn();
const disconnect = jest.fn();

/**
 * jsdom has no ResizeObserver. This stand-in keeps the callback per observed
 * target so a test can resize one element, and records observe/disconnect
 * calls so a test can assert which elements the hook watches.
 */
class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallback = callback;
  }

  observe = (target: Element) => {
    observedTargets.set(target, this.callback);
    observe(target);
  };

  unobserve = jest.fn();

  disconnect = () => disconnect();
}

function Harness({ userMessageHeight }: { userMessageHeight: number }) {
  const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
    chatHistory: CHAT_HISTORY,
  });
  const userMessageRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      node.getBoundingClientRect = () => ({ height: userMessageHeight }) as DOMRect;
    },
    [userMessageHeight]
  );
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        Object.defineProperty(node, "clientHeight", { configurable: true, value: 600 });
        node.scrollTo = jest.fn();
      }
      scrollContainerCallbackRef(node);
    },
    [scrollContainerCallbackRef]
  );

  return (
    <>
      <div data-testid="headroom">{containerMinHeight}</div>
      <div ref={containerRef} data-testid="container">
        <div
          ref={userMessageRef}
          data-message-key={getMessageKey(CHAT_HISTORY[0], 0)}
          data-testid="user-message"
        />
        <div data-message-key={getMessageKey(CHAT_HISTORY[1], 1)} />
      </div>
    </>
  );
}

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/**
 * Builds a scroll container whose geometry the test controls, since jsdom
 * performs no layout and reports every metric as zero.
 */
function createScrollContainer(metrics: ScrollMetrics): HTMLDivElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "scrollHeight", { get: () => metrics.scrollHeight });
  Object.defineProperty(container, "clientHeight", { get: () => metrics.clientHeight });
  Object.defineProperty(container, "scrollTop", {
    get: () => metrics.scrollTop,
    set: (value: number) => {
      metrics.scrollTop = value;
    },
  });
  container.scrollTo = jest.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object" && typeof options?.top === "number") {
      metrics.scrollTop = options.top;
    }
  }) as never;
  container.scrollBy = jest.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object" && typeof options?.top === "number") {
      metrics.scrollTop += options.top;
    }
  }) as never;
  return container;
}

describe("useChatScrolling", () => {
  // Queued rather than run synchronously: the hook records the pending frame
  // id after requestAnimationFrame returns, so a synchronous mock would clear
  // the ref before it is set and every later scroll event would be dropped.
  let animationFrameQueue: FrameRequestCallback[] = [];

  function flushAnimationFrames() {
    const queue = animationFrameQueue;
    animationFrameQueue = [];
    queue.forEach((callback) => callback(0));
  }

  // Maps each observed element to its observer's callback, so tests can fire
  // resizes for a specific target (container vs content) the way the browser
  // would.

  function fireResizeObserverFor(target: Element) {
    observedTargets.get(target)?.([], { disconnect: jest.fn() } as unknown as ResizeObserver);
  }

  beforeEach(() => {
    observe.mockClear();
    disconnect.mockClear();
    observedTargets = new Map();
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
    });
    animationFrameQueue = [];
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrameQueue.push(callback);
      return animationFrameQueue.length;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });

  function renderAttachedHook(metrics: ScrollMetrics) {
    const container = createScrollContainer(metrics);
    const content = document.createElement("div");
    const rendered = renderHook(() => useChatScrolling({ chatHistory: [] }));
    act(() => {
      rendered.result.current.scrollContainerCallbackRef(container);
      rendered.result.current.contentCallbackRef(content);
    });
    return { container, content, rendered };
  }

  function dispatchScroll(container: HTMLDivElement) {
    act(() => {
      container.dispatchEvent(new Event("scroll"));
      flushAnimationFrames();
    });
  }

  describe("useChatScrolling()", () => {
    it("recalculates assistant headroom when the last user row changes height (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      const { rerender } = render(<Harness userMessageHeight={360} />);
      const container = screen.getByTestId("container");
      const userMessage = screen.getByTestId("user-message");

      expect(screen.getByTestId("headroom").textContent).toBe("240");
      expect(observe).toHaveBeenCalledWith(container);
      expect(observe).toHaveBeenCalledWith(userMessage);

      rerender(<Harness userMessageHeight={500} />);
      act(() => resizeCallback([], {} as ResizeObserver));

      expect(screen.getByTestId("headroom").textContent).toBe("100");
    });
    it("reports at-bottom while the viewport rests within the threshold of the newest content", () => {
      const { rendered } = renderAttachedHook({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 590,
      });

      expect(rendered.result.current.isAtBottom).toBe(true);
    });

    it("flips isAtBottom off after the user scrolls up past the threshold (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
      const { container, rendered } = renderAttachedHook(metrics);

      metrics.scrollTop = 100;
      dispatchScroll(container);

      expect(rendered.result.current.isAtBottom).toBe(false);
    });

    it("reports at-bottom again once the user scrolls back to the newest content", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
      const { container, rendered } = renderAttachedHook(metrics);
      expect(rendered.result.current.isAtBottom).toBe(false);

      metrics.scrollTop = 600;
      dispatchScroll(container);

      expect(rendered.result.current.isAtBottom).toBe(true);
    });

    it("keeps tracking across repeated scroll-away and scroll-back cycles", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
      const { container, rendered } = renderAttachedHook(metrics);

      metrics.scrollTop = 100;
      dispatchScroll(container);
      expect(rendered.result.current.isAtBottom).toBe(false);

      metrics.scrollTop = 600;
      dispatchScroll(container);
      expect(rendered.result.current.isAtBottom).toBe(true);

      metrics.scrollTop = 50;
      dispatchScroll(container);
      expect(rendered.result.current.isAtBottom).toBe(false);
    });

    it("refreshes isAtBottom when the observed content grows without a scroll event, e.g. streaming or image loads (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
      const { content, rendered } = renderAttachedHook(metrics);
      expect(rendered.result.current.isAtBottom).toBe(true);

      metrics.scrollHeight = 2000;
      act(() => {
        fireResizeObserverFor(content);
      });

      expect(rendered.result.current.isAtBottom).toBe(false);
    });

    it("refreshes isAtBottom when a pane resize changes the viewport height without touching content (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
      const { container, rendered } = renderAttachedHook(metrics);
      expect(rendered.result.current.isAtBottom).toBe(false);

      metrics.clientHeight = 950;
      act(() => {
        fireResizeObserverFor(container);
      });

      expect(rendered.result.current.isAtBottom).toBe(true);
    });

    it("scrollToBottom scrolls the container to its full scroll height", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
      const { container, rendered } = renderAttachedHook(metrics);

      act(() => {
        rendered.result.current.scrollToBottom();
      });

      expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "smooth" });
    });

    it("scrollBy moves the container by the forwarded wheel delta without animation", () => {
      const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
      const { container, rendered } = renderAttachedHook(metrics);

      act(() => {
        rendered.result.current.scrollBy(120);
      });

      expect(container.scrollBy).toHaveBeenCalledWith({ top: 120, behavior: "instant" });
      expect(metrics.scrollTop).toBe(220);
    });
  });
});
