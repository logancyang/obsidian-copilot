import { useChatScrolling } from "@/hooks/useChatScrolling";
import { act, renderHook } from "@testing-library/react";

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
  let observedTargets = new Map<Element, ResizeObserverCallback>();

  function fireResizeObserverFor(target: Element) {
    observedTargets.get(target)?.([], { disconnect: jest.fn() } as unknown as ResizeObserver);
  }

  beforeEach(() => {
    // jsdom lacks ResizeObserver; the mock records callbacks for manual firing.
    observedTargets = new Map();
    (window as unknown as { ResizeObserver?: unknown }).ResizeObserver = jest.fn(
      (callback: ResizeObserverCallback) => ({
        observe: jest.fn((target: Element) => observedTargets.set(target, callback)),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })
    );
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
