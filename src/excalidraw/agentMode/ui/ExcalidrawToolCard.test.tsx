import {
  ExcalidrawToolCard,
  type ExcalidrawToolCardProps,
} from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const PATH = "Incidents/Investigation playbook.excalidraw.md";

function renderCard(props: Partial<ExcalidrawToolCardProps> = {}) {
  const onOpenDrawing = jest.fn();
  const result = render(
    <ExcalidrawToolCard
      action="create"
      status="completed"
      path={PATH}
      onOpenDrawing={onOpenDrawing}
      {...props}
    />
  );
  return { ...result, onOpenDrawing };
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
    ] as const)(
      "shows a %s call with its label and the drawing name as plain text, since the drawing may not exist yet",
      (status, label) => {
        renderCard({ status });

        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByText("Investigation playbook")).toBeTruthy();
        expect(screen.queryByRole("button")).toBeNull();
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
          onOpenDrawing={jest.fn()}
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
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
