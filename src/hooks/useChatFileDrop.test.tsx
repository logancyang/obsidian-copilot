import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import { TFile, type App } from "obsidian";
import React, { useEffect, useRef } from "react";

interface FakeItem {
  kind: "string" | "file";
  file?: File;
}

function makeDataTransfer(items: FakeItem[]) {
  return {
    types: [] as string[],
    dropEffect: "",
    items: items.map((item) => ({ kind: item.kind, getAsFile: () => item.file ?? null })),
  };
}

function dispatchDrag(type: "dragOver" | "drop", target: HTMLElement, items: FakeItem[]): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(items) });
  fireEvent(target, event);
}

interface HarnessProps {
  app: App;
  setContextNotes?: (update: TFile[] | ((prev: TFile[]) => TFile[])) => void;
}

const ignoreContextNotes = jest.fn();

function Harness({ app, setContextNotes = ignoreContextNotes }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes,
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
  describe("useChatFileDrop()", () => {
    it("clears the overlay when a drop lands in an inner zone that stops bubbling", () => {
      const { getByTestId } = render(<Harness app={{} as App} />);
      const overlay = getByTestId("overlay");

      dispatchDrag("dragOver", getByTestId("overlay"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("active");

      dispatchDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("idle");
    });

    it("attaches a PDF dropped from outside the vault as context once it is copied into the vault (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const copied = new (TFile as unknown as new (path: string) => TFile)(
        "attachments/report.pdf"
      );
      const app = {
        vault: { adapter: {}, createBinary: jest.fn().mockResolvedValue(copied) },
        fileManager: {
          getAvailablePathForAttachment: jest.fn().mockResolvedValue("attachments/report.pdf"),
        },
        workspace: { getActiveFile: () => null },
      } as unknown as App;
      let setContextNotes: HarnessProps["setContextNotes"];
      const attached = new Promise<TFile[]>((resolve) => {
        setContextNotes = (update) => resolve(typeof update === "function" ? update([]) : update);
      });
      const report = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
      report.arrayBuffer = () => Promise.resolve(new ArrayBuffer(4));
      const { getByTestId } = render(<Harness app={app} setContextNotes={setContextNotes} />);

      dispatchDrag("drop", getByTestId("overlay"), [{ kind: "file", file: report }]);

      await expect(attached).resolves.toEqual([copied]);
    });
  });
});
