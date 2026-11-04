import { canAttachFileToChat, useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import { TFile, type App } from "obsidian";
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
  describe("canAttachFileToChat()", () => {
    const fileAt = (path: string) => new (TFile as unknown as new (path: string) => TFile)(path);

    it("accepts notes, canvases, bases, PDFs and images that a composer drop attaches", () => {
      const paths = ["a.md", "b.canvas", "c.base", "d.pdf", "e.png", "f.jpg", "g.webp"];

      expect(paths.filter((path) => canAttachFileToChat(fileAt(path)))).toEqual(paths);
    });

    it("rejects CSV, text and source files that a composer drop reports as unsupported", () => {
      expect(
        ["data.csv", "notes.txt", "script.py"].some((path) => canAttachFileToChat(fileAt(path)))
      ).toBe(false);
    });
  });

  describe("useChatFileDrop()", () => {
    it("clears the overlay when a drop lands in an inner zone that stops bubbling", () => {
      const { getByTestId } = render(<Harness app={{} as App} />);
      const overlay = getByTestId("overlay");

      dispatchDrag("dragOver", getByTestId("overlay"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("active");

      dispatchDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("idle");
    });
  });
});
