import { AgentHomePreviewList, AgentHomeViewAllTrigger } from "@/agentMode/ui/AgentHomeSection";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentHomeSection", () => {
  describe("AgentHomePreviewList()", () => {
    it("shows the shared footer only when rows exceed the available height or preview limit (https://github.com/Brevilabs/obsidian-copilot-private/issues/169)", () => {
      const renderPreview = (hasMoreItems: boolean) => (
        <AgentHomePreviewList hasMoreItems={hasMoreItems} viewAll={<div>View all items</div>}>
          <div>Preview rows</div>
        </AgentHomePreviewList>
      );
      const { container, rerender } = render(renderPreview(false));
      const viewport = container.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      expect(viewport).not.toBeNull();
      expect(screen.queryByText("View all items")).toBeNull();

      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 300 },
      });
      rerender(renderPreview(false));
      expect(screen.getByText("View all items")).toBeTruthy();

      Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 180 });
      rerender(renderPreview(false));
      expect(screen.queryByText("View all items")).toBeNull();

      rerender(renderPreview(true));
      expect(screen.getByText("View all items")).toBeTruthy();
    });
  });

  describe("AgentHomeViewAllTrigger()", () => {
    it("uses the shared full-width style and activates from Enter or Space", () => {
      const onClick = jest.fn();
      render(<AgentHomeViewAllTrigger label="items" onClick={onClick} />);
      const trigger = screen.getByRole("button", { name: "View all items" });

      expect(trigger.classList.contains("tw-justify-between")).toBe(true);
      expect(trigger.classList.contains("tw-text-accent")).toBe(true);
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.keyDown(trigger, { key: " " });
      expect(onClick).toHaveBeenCalledTimes(2);
    });
  });
});
