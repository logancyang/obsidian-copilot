import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useRafResizable, type ResizeUpdate } from "@/hooks/use-resizable";

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

const START_RECT = {
  left: 20,
  top: 40,
  right: 320,
  bottom: 240,
  width: 300,
  height: 200,
} as DOMRect;

function ResizablePanel({ onResize }: { onResize: (next: ResizeUpdate) => void }) {
  const { handleResizeStart, isResizing } = useRafResizable({
    getRect: () => START_RECT,
    getConstraints: () => ({ minWidth: 250, minHeight: 150, maxHeight: 400 }),
    onResize,
  });
  return (
    <div data-testid="panel" data-resizing={isResizing}>
      <div data-testid="corner" onPointerDown={handleResizeStart("bottom-right")} />
    </div>
  );
}

describe("use-resizable", () => {
  describe("useRafResizable()", () => {
    it("grows the panel by the distance a touch pointer drags its corner", () => {
      const onResize = jest.fn();
      render(<ResizablePanel onResize={onResize} />);

      touchPointer(screen.getByTestId("corner"), "pointerdown", 320, 240);
      touchPointer(document, "pointermove", 360, 300);
      touchPointer(document, "pointerup", 360, 300);

      expect(onResize).toHaveBeenLastCalledWith({ width: 340, height: 260 });
      expect(screen.getByTestId("panel").dataset.resizing).toBe("false");
    });

    it("clamps the dragged size to the panel's constraints", () => {
      const onResize = jest.fn();
      render(<ResizablePanel onResize={onResize} />);

      touchPointer(screen.getByTestId("corner"), "pointerdown", 320, 240);
      touchPointer(document, "pointermove", 100, 900);
      touchPointer(document, "pointerup", 100, 900);

      expect(onResize).toHaveBeenLastCalledWith({ width: 250, height: 400 });
    });

    it("stops resizing when the browser cancels the pointer", () => {
      const onResize = jest.fn();
      render(<ResizablePanel onResize={onResize} />);

      touchPointer(screen.getByTestId("corner"), "pointerdown", 320, 240);
      touchPointer(document, "pointercancel");
      touchPointer(document, "pointermove", 400, 400);

      expect(onResize).not.toHaveBeenCalled();
      expect(screen.getByTestId("panel").dataset.resizing).toBe("false");
    });

    it("ignores a second touch so it neither resizes nor releases the panel (https://github.com/Brevilabs/obsidian-copilot-private/issues/798)", () => {
      const onResize = jest.fn();
      render(<ResizablePanel onResize={onResize} />);

      touchPointer(screen.getByTestId("corner"), "pointerdown", 320, 240, 1);
      touchPointer(document, "pointermove", 600, 600, 2);
      touchPointer(document, "pointerup", 600, 600, 2);
      expect(screen.getByTestId("panel").dataset.resizing).toBe("true");

      touchPointer(document, "pointermove", 360, 300, 1);
      touchPointer(document, "pointerup", 360, 300, 1);

      expect(onResize).toHaveBeenCalledTimes(1);
      expect(onResize).toHaveBeenLastCalledWith({ width: 340, height: 260 });
      expect(screen.getByTestId("panel").dataset.resizing).toBe("false");
    });
  });
});
