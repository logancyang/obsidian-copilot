import { ClampedContent } from "@/components/ui/clamped-content";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function stubContentDimensions(scrollHeightPx: number, clientHeightPx: number): () => void {
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeightPx,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeightPx,
  });
  return () => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
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

    it("renders content that fits without any expand control (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      restoreContentHeight = stubContentDimensions(60, 60);

      render(<ClampedContent collapsedClassName="tw-max-h-[5lh]">Short message</ClampedContent>);

      expect(screen.queryByText("Short message")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByTestId("clamped-content").getAttribute("style")).toBeNull();
    });

    it("clips content taller than the CSS cap and offers Show more (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      restoreContentHeight = stubContentDimensions(1000, 100);

      render(
        <ClampedContent collapsedClassName="tw-max-h-[5lh]">Very long message</ClampedContent>
      );

      expect(screen.getByTestId("clamped-content").classList.contains("tw-max-h-[5lh]")).toBe(true);
      expect(screen.getByRole("button", { name: /show more/i }).getAttribute("aria-expanded")).toBe(
        "false"
      );
      // Clipping is visual only, so copy and text selection still see it all.
      expect(screen.queryByText("Very long message")).not.toBeNull();
    });

    it("removes the CSS cap when expanded and restores it when collapsed again (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      restoreContentHeight = stubContentDimensions(1000, 100);

      render(
        <ClampedContent collapsedClassName="tw-max-h-[5lh]">Very long message</ClampedContent>
      );

      fireEvent.click(screen.getByRole("button", { name: /show more/i }));

      expect(screen.getByTestId("clamped-content").classList.contains("tw-max-h-[5lh]")).toBe(
        false
      );
      const collapseButton = screen.getByRole("button", { name: /show less/i });
      expect(collapseButton.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(collapseButton);

      expect(screen.getByTestId("clamped-content").classList.contains("tw-max-h-[5lh]")).toBe(true);
      expect(screen.queryByRole("button", { name: /show more/i })).not.toBeNull();
    });

    it("points the toggle at the region it controls (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      restoreContentHeight = stubContentDimensions(1000, 100);

      render(
        <ClampedContent collapsedClassName="tw-max-h-[5lh]">Very long message</ClampedContent>
      );

      const region = screen.getByTestId("clamped-content");
      expect(region.id).not.toBe("");
      expect(screen.getByRole("button", { name: /show more/i }).getAttribute("aria-controls")).toBe(
        region.id
      );
    });

    it("uses the caller's CSS cap without writing inline styles (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      restoreContentHeight = stubContentDimensions(1000, 80);

      render(
        <ClampedContent collapsedClassName="tw-max-h-[4lh]">Very long message</ClampedContent>
      );

      const content = screen.getByTestId("clamped-content");
      expect(content.classList.contains("tw-max-h-[4lh]")).toBe(true);
      expect(content.getAttribute("style")).toBeNull();
    });
  });
});
