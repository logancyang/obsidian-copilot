import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { ChatMessage } from "@/types/message";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { useCallback } from "react";

const geometry = { scrollHeight: 200, clientHeight: 100, scrollTop: 0 };
const resizeCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const userMessage = (id: string): ChatMessage => ({
  id,
  sender: "user",
  message: "Summarize this note",
  isVisible: true,
  timestamp: null,
});

const growTo = (scrollHeight: number): void => {
  geometry.scrollHeight = scrollHeight;
  act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
};

const advanceFrames = (count: number): void => {
  act(() => jest.advanceTimersByTime(16 * count));
};

function ChatScrollHarness({ chatHistory }: { chatHistory: ChatMessage[] }) {
  const { scrollContainerCallbackRef, contentCallbackRef, onScroll, isScrollPaused, scrollToEnd } =
    useChatScrolling({ chatHistory });
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        Object.defineProperties(node, {
          scrollHeight: { get: () => geometry.scrollHeight },
          clientHeight: { get: () => geometry.clientHeight },
          scrollTop: {
            get: () => geometry.scrollTop,
            set: (value: number) => {
              geometry.scrollTop = Math.min(
                value,
                Math.max(0, geometry.scrollHeight - geometry.clientHeight)
              );
            },
          },
        });
      }
      scrollContainerCallbackRef(node);
    },
    [scrollContainerCallbackRef]
  );

  return (
    <div ref={setContainerRef} onScroll={onScroll} data-testid="transcript">
      <div ref={contentCallbackRef}>{chatHistory.map((message) => message.message)}</div>
      {isScrollPaused && (
        <button type="button" onClick={scrollToEnd}>
          Scroll to end
        </button>
      )}
    </div>
  );
}

describe("useChatScrolling", () => {
  describe("useChatScrolling()", () => {
    beforeEach(() => {
      geometry.scrollHeight = 200;
      geometry.clientHeight = 100;
      geometry.scrollTop = 0;
      resizeCallbacks.length = 0;
      window.ResizeObserver = MockResizeObserver;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 follows the growing response after the initial message space fills", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      expect(geometry.scrollTop).toBe(100);

      growTo(300);
      advanceFrames(60);
      expect(geometry.scrollTop).toBe(200);
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/887 glides a line of growth into view over several frames instead of jumping", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);

      growTo(222);
      advanceFrames(1);
      expect(geometry.scrollTop).toBeGreaterThan(100);
      expect(geometry.scrollTop).toBeLessThan(110);

      advanceFrames(60);
      expect(geometry.scrollTop).toBe(122);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/887 jumps straight to the end when growth is taller than the viewport", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);

      growTo(350);
      expect(geometry.scrollTop).toBe(250);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/887 jumps straight to the end when the reader prefers reduced motion", () => {
      const matchMedia = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: true }),
      });
      try {
        render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);

        growTo(222);
        expect(geometry.scrollTop).toBe(122);
      } finally {
        Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
      }
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/887 stops gliding and pauses when the reader scrolls up mid-glide", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      growTo(260);
      advanceFrames(2);

      geometry.scrollTop = 60;
      fireEvent.scroll(screen.getByTestId("transcript"));
      advanceFrames(60);
      expect(geometry.scrollTop).toBe(60);
      expect(screen.getByRole("button", { name: "Scroll to end" })).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/887 opens a chat already at its end without gliding", () => {
      geometry.scrollHeight = 180;
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      expect(geometry.scrollTop).toBe(80);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 keeps the return control hidden when the chat is too short to scroll", () => {
      geometry.scrollHeight = 80;
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);

      fireEvent.scroll(screen.getByTestId("transcript"));
      expect(geometry.scrollTop).toBe(0);
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 pauses above the end and resumes when the reader scrolls back", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      geometry.scrollTop = 40;
      fireEvent.scroll(screen.getByTestId("transcript"));
      expect(screen.getByRole("button", { name: "Scroll to end" })).toBeTruthy();

      geometry.scrollHeight = 300;
      act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
      expect(geometry.scrollTop).toBe(40);

      geometry.scrollTop = 200;
      fireEvent.scroll(screen.getByTestId("transcript"));
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
      growTo(350);
      advanceFrames(60);
      expect(geometry.scrollTop).toBe(250);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 resumes following when a taller viewport reaches the end without a scroll event", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      geometry.scrollTop = 40;
      fireEvent.scroll(screen.getByTestId("transcript"));

      geometry.clientHeight = 160;
      act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();

      growTo(300);
      advanceFrames(60);
      expect(geometry.scrollTop).toBe(140);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 returns to the end and follows later growth when the reader uses the return control", () => {
      render(<ChatScrollHarness chatHistory={[userMessage("first")]} />);
      geometry.scrollTop = 30;
      fireEvent.scroll(screen.getByTestId("transcript"));
      fireEvent.click(screen.getByRole("button", { name: "Scroll to end" }));
      expect(geometry.scrollTop).toBe(100);
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();

      growTo(260);
      advanceFrames(60);
      expect(geometry.scrollTop).toBe(160);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 follows a new message after the reader paused on an earlier turn", () => {
      const first = userMessage("first");
      const { rerender } = render(<ChatScrollHarness chatHistory={[first]} />);
      geometry.scrollTop = 20;
      fireEvent.scroll(screen.getByTestId("transcript"));

      geometry.scrollHeight = 270;
      rerender(<ChatScrollHarness chatHistory={[first, userMessage("second")]} />);
      expect(geometry.scrollTop).toBe(170);
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
    });
  });
});
