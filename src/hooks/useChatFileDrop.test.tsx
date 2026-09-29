import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import type { App } from "obsidian";
import React, { useEffect, useRef } from "react";

interface FakeItem {
  kind: "string" | "file";
}

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

    dispatchDrag("dragOver", getByTestId("overlay"), [{ kind: "file" }]);
    expect(overlay.textContent).toBe("active");

    dispatchDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
    expect(overlay.textContent).toBe("idle");
  });
});
