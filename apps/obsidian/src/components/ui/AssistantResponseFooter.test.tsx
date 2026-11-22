import {
  AssistantResponseFooter,
  type AssistantResponseFooterProps,
} from "@/components/ui/AssistantResponseFooter";
import { formatMessageClock, formatMessageDateTime } from "@/lib/messageTime";
import { render, screen } from "@testing-library/react";
import { Platform } from "obsidian";
import React from "react";

const SENT_AT = new Date(2026, 7, 7, 20, 31, 10).getTime();
const SENT_CLOCK = formatMessageClock(SENT_AT);

const renderFooter = (props: Partial<AssistantResponseFooterProps> = {}) =>
  render(<AssistantResponseFooter actions={<span>Actions</span>} {...props} />);

const footerOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe("AssistantResponseFooter", () => {
  describe("AssistantResponseFooter()", () => {
    afterEach(() => {
      Platform.isMobile = false;
    });

    it("prefers leading metadata over the time and keeps actions at the trailing edge", () => {
      const { container } = renderFooter({
        leading: <span>Worked for 24s</span>,
        timestampMs: SENT_AT,
      });

      expect(screen.getByText("Worked for 24s")).toBeTruthy();
      expect(screen.queryByText(SENT_CLOCK)).toBeNull();
      expect(screen.getByText("Actions")).toBeTruthy();
      expect(container.querySelector("[data-response-footer-leading]")).not.toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 shows the time as a short clock time with the full date and time as its tooltip", () => {
      const { container } = renderFooter({ timestampMs: SENT_AT, actions: undefined });

      const time = screen.getByText(SENT_CLOCK);
      expect(time.getAttribute("title")).toBe(formatMessageDateTime(SENT_AT));
      expect(container.querySelector("[data-response-footer-leading]")).toBeNull();
      expect(container.querySelector("[data-response-footer-actions]")).toBeNull();
    });

    it("shows only the actions when the footer has no metadata", () => {
      const { container } = renderFooter({ leading: null });

      expect(screen.getByText("Actions")).toBeTruthy();
      expect(container.querySelector("[data-response-footer-leading]")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 dims the row and hides its time at rest, and brings both to full strength while the pointer or keyboard focus is on its response", () => {
      const { container } = renderFooter({ timestampMs: SENT_AT });

      const row = footerOf(container).className;
      const time = screen.getByText(SENT_CLOCK).className;
      expect(row).toContain("tw-opacity-50");
      expect(time).toContain("tw-opacity-0");
      for (const className of [row, time]) {
        expect(className).toContain("group-hover/response:tw-opacity-100");
        expect(className).toContain("group-focus-within/response:tw-opacity-100");
      }
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 shows the row and its time at full strength when they are shown at rest, as in the user's floating bar", () => {
      const { container } = renderFooter({ timestampMs: SENT_AT, shownAtRest: true });

      expect(footerOf(container).className).not.toContain("tw-opacity-50");
      expect(screen.getByText(SENT_CLOCK).className).not.toContain("tw-opacity-0");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 shows the row and its time at full strength on a phone, which has no pointer to hover with", () => {
      Platform.isMobile = true;
      const { container } = renderFooter({ timestampMs: SENT_AT });

      expect(footerOf(container).className).not.toContain("tw-opacity-50");
      expect(screen.getByText(SENT_CLOCK).className).not.toContain("tw-opacity-0");
    });
  });
});
