import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { fireEvent, render, screen } from "@testing-library/react";
import { Brain } from "lucide-react";
import React from "react";

describe("AgentActivityCard", () => {
  describe("AgentActivityCard()", () => {
    it("uses the shared inset without exposing static rows as controls", () => {
      const { container } = render(<AgentActivityCard icon={Brain} label="Reasoning" />);

      const header = container.querySelector("[data-agent-activity-card-header]");
      expect(header?.classList.contains("tw-pl-1")).toBe(true);
      expect(container.querySelector(".lucide-brain")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("toggles through the same pointer and keyboard interaction contract", () => {
      const onToggle = jest.fn();
      const { container, rerender } = render(
        <AgentActivityCard
          icon={Brain}
          label="Reasoning"
          expandable
          open={false}
          onToggle={onToggle}
        >
          <span>Details</span>
        </AgentActivityCard>
      );

      const closedHeader = screen.getByRole("button", { name: "Reasoning" });
      expect(closedHeader.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Details")).toBeNull();

      fireEvent.click(closedHeader);
      fireEvent.keyDown(closedHeader, { key: "Enter" });
      fireEvent.keyDown(closedHeader, { key: " " });
      expect(onToggle).toHaveBeenCalledTimes(3);

      rerender(
        <AgentActivityCard icon={Brain} label="Reasoning" expandable open onToggle={onToggle}>
          <span>Details</span>
        </AgentActivityCard>
      );

      const openHeader = screen.getByRole("button", { name: "Reasoning" });
      expect(openHeader.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("Details")).not.toBeNull();
      expect(
        container.querySelector(".lucide-chevron-right")?.classList.contains("tw-rotate-90")
      ).toBe(true);
      expect(
        container
          .querySelector(`[id="${openHeader.getAttribute("aria-controls")}"]`)
          ?.classList.contains("tw-border-l")
      ).toBe(true);
    });
  });
});
