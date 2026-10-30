import {
  ExcalidrawToolCard,
  type ExcalidrawToolCardProps,
} from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const PATH = "Incidents/Investigation playbook.excalidraw.md";

function renderCard(props: Partial<ExcalidrawToolCardProps> = {}) {
  const onOpenDrawing = jest.fn();
  const onToggle = jest.fn();
  const result = render(
    <ExcalidrawToolCard
      action="create"
      status="completed"
      path={PATH}
      failed={0}
      open={false}
      onOpenDrawing={onOpenDrawing}
      onToggle={onToggle}
      {...props}
    >
      <div>Excalidraw write failed: INVALID_INPUT</div>
    </ExcalidrawToolCard>
  );
  return { ...result, onOpenDrawing, onToggle };
}

describe("ExcalidrawToolCard", () => {
  describe("ExcalidrawToolCard()", () => {
    it.each([
      ["create", "Drew in Excalidraw"],
      ["edit", "Edited in Excalidraw"],
      ["read", "Read Excalidraw drawing"],
    ] as const)(
      "credits Copilot's Excalidraw tools for a finished %s and names the drawing without its extension",
      (action, label) => {
        const { container } = renderCard({ action });

        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Investigation playbook" })).toBeTruthy();
        expect(container.querySelector("svg")).toBeTruthy();
      }
    );

    it("opens the drawing at its full path when its name is clicked", () => {
      const { onOpenDrawing } = renderCard();

      fireEvent.click(screen.getByRole("button", { name: "Investigation playbook" }));

      expect(onOpenDrawing).toHaveBeenCalledWith(PATH);
    });

    it.each([
      ["pending", "Drawing in Excalidraw"],
      ["in_progress", "Drawing in Excalidraw"],
      ["cancelled", "Excalidraw drawing stopped"],
      ["failed", "Couldn't draw in Excalidraw"],
    ] as const)(
      "shows a %s call with its label and the drawing name as plain text, since the drawing may not exist yet",
      (status, label) => {
        renderCard({ status });

        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByText("Investigation playbook")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Investigation playbook" })).toBeNull();
      }
    );

    it("shimmers the label only while the call runs", () => {
      const { container, rerender } = renderCard({ action: "edit", status: "in_progress" });
      expect(container.querySelector(".copilot-shimmer-text")?.textContent).toBe(
        "Editing in Excalidraw"
      );

      rerender(
        <ExcalidrawToolCard
          action="edit"
          status="completed"
          path={PATH}
          failed={0}
          open={false}
          onOpenDrawing={jest.fn()}
          onToggle={jest.fn()}
        />
      );
      expect(container.querySelector(".copilot-shimmer-text")).toBeNull();
    });

    it("names a .excalidraw drawing without its extension", () => {
      renderCard({ path: "Board.excalidraw" });
      expect(screen.getByRole("button", { name: "Board" })).toBeTruthy();
    });

    it("shows only the label when the call has no path", () => {
      renderCard({ action: "read", path: null });

      expect(screen.getByText("Read Excalidraw drawing")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Investigation playbook" })).toBeNull();
    });

    it("keeps the drawing's steps hidden until the chevron is clicked", () => {
      const { onToggle } = renderCard();

      expect(screen.queryByText("Excalidraw write failed: INVALID_INPUT")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show Excalidraw steps" }));
      expect(onToggle).toHaveBeenCalled();
    });

    it("shows the drawing's steps, such as a failed write's error, when open", () => {
      renderCard({ open: true });

      expect(screen.getByText("Excalidraw write failed: INVALID_INPUT")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Hide Excalidraw steps" }).getAttribute("aria-expanded")
      ).toBe("true");
    });

    it("counts failed calls on the card so a rejected write is not hidden (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      renderCard({ failed: 2 });
      expect(screen.getByText("2 failed")).toBeTruthy();
    });

    it("shows no failure count when every call went through", () => {
      renderCard();
      expect(screen.queryByText(/failed/)).toBeNull();
    });
  });
});
