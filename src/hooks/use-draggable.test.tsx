import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useDraggable } from "@/hooks/use-draggable";

function touchPointer(
  target: EventTarget,
  type: string,
  clientX = 0,
  clientY = 0,
  pointerId = 1
): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  act(() => {
    target.dispatchEvent(event);
  });
}

function DraggablePanel() {
  const { dragRef, handlePointerDown, position, isDragging } = useDraggable({
    initialPosition: { x: 10, y: 20 },
    bounds: null,
  });
  return (
    <div ref={dragRef} data-testid="panel" data-dragging={isDragging}>
      <div data-testid="handle" onPointerDown={handlePointerDown} />
      <span data-testid="position">{`${position.x},${position.y}`}</span>
    </div>
  );
}

describe("use-draggable", () => {
  describe("useDraggable()", () => {
    it("moves the panel by the distance a touch pointer travels from the handle", () => {
      render(<DraggablePanel />);

      touchPointer(screen.getByTestId("handle"), "pointerdown", 100, 100);
      touchPointer(document, "pointermove", 130, 60);
      touchPointer(document, "pointerup", 130, 60);

      expect(screen.getByTestId("position").textContent).toBe("40,-20");
      expect(screen.getByTestId("panel").style.getPropertyValue("--copilot-drag-x")).toBe("40px");
      expect(screen.getByTestId("panel").dataset.dragging).toBe("false");
    });

    it("ends the drag when the browser cancels the pointer, ignoring later moves", () => {
      render(<DraggablePanel />);

      touchPointer(screen.getByTestId("handle"), "pointerdown", 100, 100);
      touchPointer(document, "pointermove", 110, 110);
      touchPointer(document, "pointercancel");
      touchPointer(document, "pointermove", 300, 300);

      expect(screen.getByTestId("position").textContent).toBe("20,30");
      expect(screen.getByTestId("panel").dataset.dragging).toBe("false");
    });

    it("ignores a second touch so it neither moves nor releases the panel (https://github.com/Brevilabs/obsidian-copilot-private/issues/798)", () => {
      render(<DraggablePanel />);

      touchPointer(screen.getByTestId("handle"), "pointerdown", 100, 100, 1);
      touchPointer(document, "pointermove", 400, 400, 2);
      touchPointer(document, "pointerup", 400, 400, 2);
      expect(screen.getByTestId("panel").dataset.dragging).toBe("true");

      touchPointer(document, "pointermove", 130, 60, 1);
      touchPointer(document, "pointerup", 130, 60, 1);

      expect(screen.getByTestId("position").textContent).toBe("40,-20");
      expect(screen.getByTestId("panel").dataset.dragging).toBe("false");
    });
  });
});
