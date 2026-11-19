import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { fireEvent, render, screen } from "@testing-library/react";
import { Brain } from "lucide-react";
import React from "react";

describe("AgentActivityCard", () => {
  describe("AgentActivityCard()", () => {
    it("shows its icon and label without exposing a static row as a control", () => {
      const { container } = render(<AgentActivityCard icon={Brain} label="Reasoning" />);

      expect(screen.getByText("Reasoning")).toBeTruthy();
      expect(container.querySelector(".lucide-brain")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("shows an element given as its icon, such as an agent's face, in the icon's place (https://github.com/Brevilabs/obsidian-copilot-private/issues/947)", () => {
      const { container } = render(
        <AgentActivityCard icon={<img src="face.webp" alt="" />} label="Asked Maya" />
      );

      expect(container.querySelector("img")?.getAttribute("src")).toBe("face.webp");
    });

    it("toggles on click, Enter, and Space and reveals its details only while open", () => {
      const onToggle = jest.fn();
      const { rerender } = render(
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
    });

    it("opens what it stands for on click, Enter, and Space when given onOpen, under its own accessible name, without an icon or a chevron (https://github.com/Brevilabs/obsidian-copilot-private/issues/967)", () => {
      const onOpen = jest.fn();
      const { container } = render(
        <AgentActivityCard
          label="Messaged Leo"
          onOpen={onOpen}
          ariaLabel="Open Coco's conversation with Leo"
        />
      );

      const card = screen.getByRole("button", { name: "Open Coco's conversation with Leo" });
      fireEvent.click(card);
      fireEvent.keyDown(card, { key: "Enter" });
      fireEvent.keyDown(card, { key: " " });

      expect(onOpen).toHaveBeenCalledTimes(3);
      expect(card.textContent).toBe("Messaged Leo");
      expect(card.getAttribute("aria-expanded")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();
    });
  });
});
