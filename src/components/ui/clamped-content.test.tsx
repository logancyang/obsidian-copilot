import { ClampedContent } from "@/components/ui/clamped-content";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/**
 * JSDOM lays nothing out, so `scrollHeight` is always 0 and computed
 * `line-height` is `normal`. Stubbing the natural content height is what lets a
 * test choose whether the content sits over or under the clamp.
 */
function stubContentHeight(heightPx: number): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => heightPx,
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  };
}

describe("clamped-content", () => {
  describe("ClampedContent()", () => {
    let restoreContentHeight: (() => void) | undefined;

    afterEach(() => {
      restoreContentHeight?.();
      restoreContentHeight = undefined;
    });

    it("renders content that fits without any expand control", () => {
      // 3 lines at the 20px fallback line height stays under a 5-line clamp.
      restoreContentHeight = stubContentHeight(60);

      render(<ClampedContent collapsedLines={5}>Short message</ClampedContent>);

      expect(screen.queryByText("Short message")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByTestId("clamped-content").style.maxHeight).toBe("");
    });

    it("clips content taller than the clamp to the line budget and offers Show more", () => {
      restoreContentHeight = stubContentHeight(1000);

      render(<ClampedContent collapsedLines={5}>Very long message</ClampedContent>);

      // 5 lines at the 20px fallback line height.
      expect(screen.getByTestId("clamped-content").style.maxHeight).toBe("100px");
      expect(screen.getByRole("button", { name: /show more/i }).getAttribute("aria-expanded")).toBe(
        "false"
      );
      // Clipping is visual only, so copy and text selection still see it all.
      expect(screen.queryByText("Very long message")).not.toBeNull();
    });

    it("removes the height cap when expanded and restores it when collapsed again", () => {
      restoreContentHeight = stubContentHeight(1000);

      render(<ClampedContent collapsedLines={5}>Very long message</ClampedContent>);

      fireEvent.click(screen.getByRole("button", { name: /show more/i }));

      expect(screen.getByTestId("clamped-content").style.maxHeight).toBe("");
      const collapseButton = screen.getByRole("button", { name: /show less/i });
      expect(collapseButton.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(collapseButton);

      expect(screen.getByTestId("clamped-content").style.maxHeight).toBe("100px");
      expect(screen.queryByRole("button", { name: /show more/i })).not.toBeNull();
    });

    it("points the toggle at the region it controls", () => {
      restoreContentHeight = stubContentHeight(1000);

      render(<ClampedContent collapsedLines={5}>Very long message</ClampedContent>);

      const region = screen.getByTestId("clamped-content");
      expect(region.id).not.toBe("");
      expect(screen.getByRole("button", { name: /show more/i }).getAttribute("aria-controls")).toBe(
        region.id
      );
    });

    it("derives the height cap from the measured line height rather than a fixed size", () => {
      restoreContentHeight = stubContentHeight(1000);
      const computedStyle = jest
        .spyOn(window, "getComputedStyle")
        .mockReturnValue({ lineHeight: "30px" } as CSSStyleDeclaration);

      try {
        render(<ClampedContent collapsedLines={4}>Very long message</ClampedContent>);

        expect(screen.getByTestId("clamped-content").style.maxHeight).toBe("120px");
      } finally {
        computedStyle.mockRestore();
      }
    });
  });
});
