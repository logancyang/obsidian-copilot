import { canAttachFileToChat, useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import { TFile, type App } from "obsidian";
import React, { useEffect, useRef } from "react";

interface FakeItem {
  kind: "string" | "file";
  file?: File;
  text?: string;
}

function makeDataTransfer(items: FakeItem[], isDispatching: () => boolean) {
  return {
    types: [] as string[],
    dropEffect: "",
    items: items.map((item) => ({
      kind: item.kind,
      getAsFile: () => (isDispatching() ? (item.file ?? null) : null),
      getAsString: (callback: (data: string) => void) => callback(item.text ?? ""),
    })),
  };
}

function dispatchDrag(type: "dragOver" | "drop", target: HTMLElement, items: FakeItem[]): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  let dispatching = true;
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(items, () => dispatching),
  });
  fireEvent(target, event);
  dispatching = false;
}

interface HarnessProps {
  app: App;
  setContextNotes?: (update: TFile[] | ((prev: TFile[]) => TFile[])) => void;
  acceptAnyFileType?: boolean;
}

const ignoreContextNotes = jest.fn();

function Harness({ app, setContextNotes = ignoreContextNotes, acceptAnyFileType }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes,
    selectedImages: [],
    onAddImage: jest.fn(),
    containerRef,
    acceptAnyFileType,
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

    function dropExternalFile(
      name: string,
      type: string,
      acceptAnyFileType?: boolean,
      extraItems: FakeItem[] = []
    ) {
      const copied = new (TFile as unknown as new (path: string) => TFile)(`attachments/${name}`);
      const app = {
        vault: { adapter: {}, createBinary: jest.fn().mockResolvedValue(copied) },
        fileManager: {
          getAvailablePathForAttachment: jest.fn().mockResolvedValue(`attachments/${name}`),
        },
        workspace: { getActiveFile: () => null },
      } as unknown as App;
      let setContextNotes: HarnessProps["setContextNotes"];
      const attached = new Promise<TFile[]>((resolve) => {
        setContextNotes = (update) => resolve(typeof update === "function" ? update([]) : update);
      });
      const file = new File(["data"], name, { type });
      file.arrayBuffer = () => Promise.resolve(new ArrayBuffer(4));
      const { getByTestId } = render(
        <Harness
          app={app}
          setContextNotes={setContextNotes}
          acceptAnyFileType={acceptAnyFileType}
        />
      );

      dispatchDrag("drop", getByTestId("overlay"), [...extraItems, { kind: "file", file }]);

      return { attached, copied };
    }

    it("attaches a PDF dropped from outside the vault as context once it is copied into the vault (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const { attached, copied } = dropExternalFile("report.pdf", "application/pdf");

      await expect(attached).resolves.toEqual([copied]);
    });

    it("attaches a dropped file of any type when any type is accepted, as in Agent Chat (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const { attached, copied } = dropExternalFile("brief.docx", "application/msword", true);

      await expect(attached).resolves.toEqual([copied]);
    });

    it("attaches a dropped file whose drag also carries its name as text, as WeChat sends it (https://github.com/Brevilabs/obsidian-copilot-private/issues/898)", async () => {
      const { attached, copied } = dropExternalFile("report.pdf", "application/pdf", false, [
        { kind: "string", text: "report.pdf" },
      ]);

      await expect(attached).resolves.toEqual([copied]);
    });
  });
});
