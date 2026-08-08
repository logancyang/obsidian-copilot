import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import type { App } from "obsidian";
import React, { useEffect, useRef } from "react";

/**
 * Regression guard for the stuck drag-overlay bug: a drop that lands in an inner
 * `data-copilot-drop-zone` stops propagating in the BUBBLE phase (the zone owns
 * its own persistence), so the outer chat container's bubble `handleDrop` never
 * runs to clear `isDragActive`. The fix is a CAPTURE-phase cleanup listener that
 * fires before the inner zone's stopPropagation — this test pins that contract.
 */

interface FakeItem {
  kind: "string" | "file";
}

/** Minimal DataTransfer carrying only the fields the hook reads. */
function makeDataTransfer(items: FakeItem[]) {
  return {
    types: [] as string[],
    dropEffect: "",
    items: items.map((item) => ({ kind: item.kind })),
  };
}

function dispatchDrag(type: "dragOver" | "drop", target: HTMLElement, items: FakeItem[]): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(items) });
  fireEvent(target, event);
}

/**
 * Outer container wired to the hook, with an inner drop zone that mimics
 * `usePersistentContextDrop`: a native bubble-phase `drop` listener that stops
 * propagation, so the outer bubble handler is bypassed exactly as in production.
 */
function Harness({ app }: { app: App }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes: jest.fn(),
    selectedImages: [],
    onAddImage: jest.fn(),
    containerRef,
  });

  useEffect(() => {
    const innerZone = innerZoneRef.current;
    if (!innerZone) return;
    const stopBubble = (event: Event) => event.stopPropagation();
    innerZone.addEventListener("drop", stopBubble);
    return () => innerZone.removeEventListener("drop", stopBubble);
  }, []);

  return (
    <div ref={containerRef}>
      <div data-testid="overlay">{isDragActive ? "active" : "idle"}</div>
      <div ref={innerZoneRef} data-copilot-drop-zone="" data-testid="inner-zone" />
    </div>
  );
}

describe("useChatFileDrop", () => {
  it("clears the overlay when a drop lands in an inner zone that stops bubbling", () => {
    const { getByTestId } = render(<Harness app={{} as App} />);
    const overlay = getByTestId("overlay");

    // Dragging over the outer container raises the overlay.
    dispatchDrag("dragOver", getByTestId("overlay"), [{ kind: "file" }]);
    expect(overlay.textContent).toBe("active");

    // Dropping into the inner zone (which stops bubble propagation) must still
    // clear the overlay via the capture-phase listener.
    dispatchDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
    expect(overlay.textContent).toBe("idle");
  });
});
