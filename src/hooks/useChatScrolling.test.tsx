import { AI_SENDER, USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { ChatMessage } from "@/types/message";
import { act, render, screen } from "@testing-library/react";
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
const observe = jest.fn();
const disconnect = jest.fn();

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
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

describe("useChatScrolling", () => {
  describe("useChatScrolling()", () => {
    beforeEach(() => {
      observe.mockClear();
      disconnect.mockClear();
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: MockResizeObserver,
      });
    });

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
  });
});
