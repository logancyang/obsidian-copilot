import {
  CollapsibleUserText,
  type CollapsibleUserTextProps,
} from "@/components/chat-components/ui/CollapsibleUserText";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/151";

function renderText(props: CollapsibleUserTextProps) {
  return render(<CollapsibleUserText {...props} />);
}

describe("CollapsibleUserText", () => {
  describe("CollapsibleUserText()", () => {
    let scrollHeight: jest.SpyInstance;
    let clientHeight: jest.SpyInstance;
    let originalResizeObserver: typeof ResizeObserver | undefined;

    beforeEach(() => {
      scrollHeight = jest.spyOn(HTMLElement.prototype, "scrollHeight", "get");
      clientHeight = jest.spyOn(HTMLElement.prototype, "clientHeight", "get");
      originalResizeObserver = window.ResizeObserver;
    });

    afterEach(() => {
      scrollHeight.mockRestore();
      clientHeight.mockRestore();
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
      });
    });

    it(`leaves short user text unchanged without a disclosure control (${ISSUE_URL})`, () => {
      scrollHeight.mockReturnValue(480);
      clientHeight.mockReturnValue(480);

      renderText({ children: "Summarize this note." });

      expect(screen.getByText("Summarize this note.")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });

    it(`starts overflowing user text collapsed and expands or collapses it explicitly (${ISSUE_URL})`, () => {
      scrollHeight.mockReturnValue(720);
      clientHeight.mockReturnValue(600);

      renderText({ children: "A complete pasted log remains here." });

      const showMore = screen.getByRole("button", { name: "Show more" });
      const content = screen.getByText("A complete pasted log remains here.");
      expect(showMore.getAttribute("aria-expanded")).toBe("false");
      expect(content.classList.contains("tw-max-h-[60vh]")).toBe(true);
      expect(content.textContent).toBe("A complete pasted log remains here.");

      fireEvent.click(showMore);

      const showLess = screen.getByRole("button", { name: "Show less" });
      expect(showLess.getAttribute("aria-expanded")).toBe("true");
      expect(content.classList.contains("tw-max-h-[60vh]")).toBe(false);

      fireEvent.click(showLess);

      expect(screen.getByRole("button", { name: "Show more" })).not.toBeNull();
      expect(content.classList.contains("tw-max-h-[60vh]")).toBe(true);
    });

    it(`rechecks rendered overflow when the owning window reports a resize (${ISSUE_URL})`, () => {
      scrollHeight.mockReturnValue(480);
      clientHeight.mockReturnValue(480);
      let resizeCallback: ResizeObserverCallback = () => undefined;
      const observe = jest.fn();
      const disconnect = jest.fn();
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: jest.fn((callback: ResizeObserverCallback) => {
          resizeCallback = callback;
          return { observe, disconnect, unobserve: jest.fn() };
        }),
      });

      renderText({ children: "Text that wraps after the pane narrows." });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

      scrollHeight.mockReturnValue(720);
      clientHeight.mockReturnValue(600);
      act(() => resizeCallback([], {} as ResizeObserver));

      expect(screen.getByRole("button", { name: "Show more" })).not.toBeNull();
    });
  });
});
