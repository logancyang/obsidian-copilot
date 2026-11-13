import { FolderPillNode } from "@/components/chat-components/pills/FolderPillNode";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render } from "@testing-library/react";
import { $createParagraphNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { TFile, TFolder, type App } from "obsidian";
import React, { useEffect, useRef } from "react";

interface FakeDrag {
  types?: string[];
  files?: File[];
}

function makeDataTransfer({ types = [], files = [] }: FakeDrag, isDispatching: () => boolean) {
  const items = files.map(() => ({
    kind: "file",
    webkitGetAsEntry: () => ({ isDirectory: false }),
  }));
  return {
    types,
    dropEffect: "",
    get items() {
      return isDispatching() ? items : [];
    },
    get files() {
      return isDispatching() ? files : [];
    },
  };
}

function dispatchDrag(type: "dragOver" | "drop", target: HTMLElement, drag: FakeDrag): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  let dispatching = true;
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(drag, () => dispatching),
  });
  fireEvent(target, event);
  dispatching = false;
}

function vaultFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeApp({ draggable = null }: { draggable?: unknown } = {}) {
  const createBinary = jest.fn(async (path: string) => vaultFile(path));
  const app = {
    dragManager: { draggable },
    vault: {
      adapter: { exists: async () => false, mkdir: async () => {} },
      createBinary,
      getAbstractFileByPath: () => null,
    },
    fileManager: { getAvailablePathForAttachment: async (name: string) => `attachments/${name}` },
    workspace: { getActiveFile: () => null },
  } as unknown as App;
  return { app, createBinary };
}

function vaultFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

interface HarnessProps {
  app: App;
  editor?: LexicalEditor;
  setContextNotes?: (update: TFile[] | ((prev: TFile[]) => TFile[])) => void;
  projectFolderPath?: string;
}

const ignoreContextNotes = jest.fn();

function Harness(props: HarnessProps) {
  return (
    <ChatInputProvider>
      <DropTarget {...props} />
    </ChatInputProvider>
  );
}

function DropTarget({
  app,
  editor,
  setContextNotes = ignoreContextNotes,
  projectFolderPath,
}: HarnessProps) {
  const { registerEditor } = useChatInput();
  useEffect(() => {
    if (editor) registerEditor(editor);
  }, [registerEditor, editor]);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes,
    selectedImages: [],
    onAddImage: jest.fn(),
    containerRef,
    projectFolderPath,
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

function renderAndCaptureAttached(app: App, projectFolderPath?: string) {
  const attached = new Promise<TFile[]>((resolve) => {
    const setContextNotes: HarnessProps["setContextNotes"] = (update) =>
      resolve(typeof update === "function" ? update([]) : update);
    render(
      <Harness app={app} setContextNotes={setContextNotes} projectFolderPath={projectFolderPath} />
    );
  });
  return attached;
}

describe("useChatFileDrop", () => {
  describe("useChatFileDrop()", () => {
    it("attaches a note dragged from Obsidian's file explorer without copying it into the vault", async () => {
      const note = vaultFile("Notes/Welcome.md");
      const { app, createBinary } = makeApp({ draggable: { type: "file", file: note } });
      const attached = renderAndCaptureAttached(app);

      dispatchDrag("drop", document.querySelector("[data-testid=overlay]")!, {
        types: ["text/plain", "text/uri-list"],
      });

      await expect(attached).resolves.toEqual([note]);
      expect(createBinary).not.toHaveBeenCalled();
    });

    it("attaches a note dragged from a Copilot row such as Relevant Notes, without showing the drop overlay", async () => {
      const note = vaultFile("Notes/Welcome.md");
      const { app } = makeApp({ draggable: { type: "link", linktext: "Welcome", file: note } });
      const attached = renderAndCaptureAttached(app);
      const overlay = document.querySelector<HTMLElement>("[data-testid=overlay]")!;
      const drag = { types: ["copilot/internal-drag", "text/plain"] };

      dispatchDrag("dragOver", overlay, drag);
      expect(overlay.textContent).toBe("idle");
      dispatchDrag("drop", overlay, drag);

      await expect(attached).resolves.toEqual([note]);
    });

    it("mentions a folder dragged from Obsidian's file explorer in the message by its full vault path (https://github.com/logancyang/obsidian-copilot/issues/3858)", async () => {
      const folder = vaultFolder("Projects/Alpha/docs");
      const { app } = makeApp({ draggable: { type: "folder", file: folder } });
      const editor = createEditor({ nodes: [FolderPillNode] });
      editor.update(() => $getRoot().append($createParagraphNode()), { discrete: true });
      render(<Harness app={app} editor={editor} />);
      const message = new Promise<string>((resolve) => {
        editor.registerUpdateListener(({ editorState }) =>
          resolve(editorState.read(() => $getRoot().getTextContent()))
        );
      });

      dispatchDrag("drop", document.querySelector("[data-testid=overlay]")!, {
        types: ["text/plain"],
      });

      await expect(message).resolves.toBe("{Projects/Alpha/docs} ");
    });

    it("copies and attaches a file dropped with its name as text, as WeChat sends it, reading the file before the drop event ends (https://github.com/Brevilabs/obsidian-copilot-private/issues/898)", async () => {
      const { app, createBinary } = makeApp();
      const attached = renderAndCaptureAttached(app);
      const report = new File(["data"], "report.pdf", { type: "application/pdf" });
      report.arrayBuffer = () => Promise.resolve(new ArrayBuffer(4));

      dispatchDrag("drop", document.querySelector("[data-testid=overlay]")!, {
        types: ["text/plain", "Files"],
        files: [report],
      });

      await expect(attached).resolves.toEqual([vaultFile("attachments/report.pdf")]);
      expect(createBinary).toHaveBeenCalledWith("attachments/report.pdf", expect.any(ArrayBuffer));
    });

    it("copies a file dropped on a project's chat input into that project's sources folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/898)", async () => {
      const { app, createBinary } = makeApp();
      const attached = renderAndCaptureAttached(app, "copilot/projects/Q4 Launch");
      const report = new File(["data"], "report.pdf", { type: "application/pdf" });
      report.arrayBuffer = () => Promise.resolve(new ArrayBuffer(4));

      dispatchDrag("drop", document.querySelector("[data-testid=overlay]")!, {
        types: ["Files"],
        files: [report],
      });

      await expect(attached).resolves.toEqual([
        vaultFile("copilot/projects/Q4 Launch/sources/report.pdf"),
      ]);
      expect(createBinary).toHaveBeenCalledWith(
        "copilot/projects/Q4 Launch/sources/report.pdf",
        expect.any(ArrayBuffer)
      );
    });

    it("clears the overlay when a drop lands in an inner zone that stops bubbling", () => {
      const { getByTestId } = render(<Harness app={makeApp().app} />);
      const overlay = getByTestId("overlay");

      dispatchDrag("dragOver", overlay, { types: ["Files"], files: [new File([], "a.pdf")] });
      expect(overlay.textContent).toBe("active");

      dispatchDrag("drop", getByTestId("inner-zone"), { types: ["Files"] });
      expect(overlay.textContent).toBe("idle");
    });
  });
});
