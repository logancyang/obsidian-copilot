import {
  AssistantResponseFooter,
  type AssistantResponseFooterProps,
} from "@/components/ui/AssistantResponseFooter";
import { render, screen } from "@testing-library/react";
import React from "react";

const renderFooter = (props: Partial<AssistantResponseFooterProps> = {}) =>
  render(<AssistantResponseFooter actions={<span>Actions</span>} {...props} />);

describe("AssistantResponseFooter", () => {
  describe("AssistantResponseFooter()", () => {
    it("places leading metadata before the timestamp and keeps actions at the trailing edge", () => {
      const { container } = renderFooter({
        leading: <span>Worked for 24s</span>,
        timestamp: "2026/08/07 20:31:10",
      });

      const footer = container.firstElementChild;
      const leading = screen.getByText("Worked for 24s");
      const timestamp = screen.getByText("2026/08/07 20:31:10");
      const actions = screen.getByText("Actions");

      expect(
        Boolean(leading.compareDocumentPosition(timestamp) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(true);
      expect(timestamp.classList.contains("tw-truncate")).toBe(true);
      expect(actions.parentElement?.classList.contains("tw-ml-auto")).toBe(true);
      expect(footer?.classList.contains("tw-min-w-0")).toBe(true);
    });

    it("right-aligns actions when the footer has no metadata", () => {
      const { container } = renderFooter({ leading: null });

      expect(screen.getByText("Actions").parentElement?.classList.contains("tw-ml-auto")).toBe(
        true
      );
      expect(screen.queryByText("Worked for 24s")).toBeNull();
      expect(container.querySelector("[data-response-footer-leading]")).toBeNull();
    });
  });
});
