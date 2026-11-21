import { ToolCard, ToolCardRowButton, type ToolCardProps } from "@/agentMode/ui/ToolCard";
import { fireEvent, render, screen } from "@testing-library/react";
import { Brain } from "lucide-react";
import React from "react";

function renderCard(props: Partial<ToolCardProps> = {}) {
  return render(
    <ToolCard
      icon={Brain}
      label="Coco remembered"
      quote="Lead with user value."
      open={false}
      {...props}
    >
      <div>Body row</div>
    </ToolCard>
  );
}

describe("ToolCard", () => {
  describe("ToolCard()", () => {
    it("shows the icon, label, quoted text and outcome on one header line, cutting the quote first", () => {
      const { container } = renderCard({ outcome: "4 notes" });

      expect(container.querySelector(".lucide-brain")?.getAttribute("class")).toContain(
        "tw-size-4"
      );
      expect(screen.getByText("Coco remembered").className).toContain("tw-shrink-0");
      expect(screen.getByText("“Lead with user value.”").className).toContain("tw-truncate");
      expect(screen.getByText("4 notes").className).toContain("tw-shrink-0");
    });

    it("opens and closes its body from the header when it can be toggled", () => {
      const onToggle = jest.fn();
      const { rerender } = renderCard({ onToggle });
      const header = screen.getByRole("button", { name: /Coco remembered/ });

      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Body row")).toBeNull();
      fireEvent.click(header);
      fireEvent.keyDown(header, { key: "Enter" });
      expect(onToggle).toHaveBeenCalledTimes(2);

      rerender(
        <ToolCard icon={Brain} label="Coco remembered" open onToggle={onToggle}>
          <div>Body row</div>
        </ToolCard>
      );
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(header.getAttribute("aria-controls")!)?.textContent).toBe(
        "Body row"
      );
    });

    it("offers no toggle and no body when it cannot be toggled, even when asked to open", () => {
      renderCard({ open: true });

      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText("Body row")).toBeNull();
    });

    it("tints the border with the accent, and shimmers or reddens the label for a running or failed state", () => {
      const { container, rerender } = renderCard({ state: "running" });
      expect(container.firstElementChild?.className).toContain("tw-border-interactive-accent/40");
      expect(screen.getByText("Coco remembered").className).toContain("copilot-shimmer-text");

      rerender(<ToolCard icon={Brain} label="Coco remembered" open={false} state="failed" />);
      expect(container.firstElementChild?.className).toContain("tw-border-border");
      expect(screen.getByText("Coco remembered").className).toContain("tw-text-error");
    });

    it("shows a detail line inside the header and a notice below it, both without opening the card", () => {
      renderCard({
        onToggle: () => {},
        detail: "net::ERR_CONNECTION_REFUSED",
        notice: <div>Goes against the instruction</div>,
      });
      const header = screen.getByRole("button", { name: /Coco remembered/ });

      expect(header.contains(screen.getByText("net::ERR_CONNECTION_REFUSED"))).toBe(true);
      expect(header.contains(screen.getByText("Goes against the instruction"))).toBe(false);
    });
  });

  describe("ToolCardRowButton()", () => {
    it("is a body row button that runs its click handler", () => {
      const onClick = jest.fn();
      render(<ToolCardRowButton onClick={onClick}>MEMORY</ToolCardRowButton>);

      fireEvent.click(screen.getByRole("button", { name: "MEMORY" }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
