jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownView: class MarkdownView {},
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";

import { CHAT_AGENT_VIEWTYPE, CHAT_VIEWTYPE } from "@/constants";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
} from "@/editor/chatSelectionHighlightController";
import type CopilotPlugin from "@/main";
import type { SelectedTextContext } from "@/types/message";

const ISSUE_983 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/983";
const NOTE_TEXT = "Alpha beta gamma";
const BETA = { anchor: 6, head: 10 };

interface FakeHighlight {
  ranges: Range[];
}

const NOTE_SELECTION_CONTEXT: SelectedTextContext = {
  id: "selection-1",
  content: "beta",
  sourceType: "note",
  noteTitle: "Note",
  notePath: "Note.md",
  startLine: 1,
  endLine: 1,
};

describe("chatSelectionHighlightController", () => {
  const editors: EditorView[] = [];
  const cleanups: Array<() => void> = [];
  const realCss = Object.getOwnPropertyDescriptor(window, "CSS");
  let activeNote: MarkdownView | null;
  let controller: ChatSelectionHighlightController;
  let readingHighlights: Map<string, FakeHighlight>;
  let watchedDocuments: Document[];
  let openWindow: (win: { doc: Document }) => void;

  function openNote(selection?: { anchor: number; head: number }): {
    leaf: WorkspaceLeaf;
    editor: EditorView;
  } {
    const editor = new EditorView({
      state: EditorState.create({ doc: NOTE_TEXT, selection }),
      parent: window.document.createElement("div"),
    });
    editors.push(editor);
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
      editor: { cm: editor },
      getMode: () => "source",
    });
    const leaf = { view, getViewState: () => ({ type: "markdown" }) } as unknown as WorkspaceLeaf;
    view.leaf = leaf;
    return { leaf, editor };
  }

  function openReadingNote(): { leaf: WorkspaceLeaf; rendered: Text } {
    const preview = window.document.createElement("div");
    preview.textContent = NOTE_TEXT;
    window.document.body.append(preview);
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
      containerEl: preview,
      previewMode: { containerEl: preview },
      getMode: () => "preview",
    });
    const leaf = { view, getViewState: () => ({ type: "markdown" }) } as unknown as WorkspaceLeaf;
    view.leaf = leaf;
    return { leaf, rendered: preview.firstChild as Text };
  }

  function selectRendered(text: Text, { anchor, head }: { anchor: number; head: number }): void {
    const range = window.document.createRange();
    range.setStart(text, anchor);
    range.setEnd(text, head);
    const selection = window.document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    window.document.dispatchEvent(new Event("selectionchange"));
  }

  function focusChatFromReadingNote(type: string): void {
    window.document.getSelection()!.removeAllRanges();
    focus(leafOfType(type));
  }

  function readingHighlightText(): string | null {
    return readingHighlights.get("copilot-chat-selection")?.ranges[0].toString() ?? null;
  }

  function focus(leaf: WorkspaceLeaf): void {
    activeNote = leaf.view instanceof MarkdownView ? leaf.view : null;
    controller.handleActiveLeafChange(leaf);
  }

  function leafOfType(type: string): WorkspaceLeaf {
    return { view: {}, getViewState: () => ({ type }) } as unknown as WorkspaceLeaf;
  }

  function highlightedText(editor: EditorView): string | null {
    return (
      editor.contentDOM.querySelector(".copilot-chat-selection-highlight")?.textContent ?? null
    );
  }

  beforeEach(() => {
    activeNote = null;
    readingHighlights = new Map();
    watchedDocuments = [];
    Object.assign(window, {
      CSS: { highlights: readingHighlights },
      Highlight: class implements FakeHighlight {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    });
    const plugin = {
      app: {
        workspace: {
          getActiveViewOfType: () => activeNote,
          on: (_name: string, callback: typeof openWindow) => {
            openWindow = callback;
          },
        },
      },
      registerEvent: jest.fn(),
      registerDomEvent: (doc: Document, type: string, listener: () => void) => {
        watchedDocuments.push(doc);
        doc.addEventListener(type, listener);
        cleanups.push(() => doc.removeEventListener(type, listener));
      },
    } as unknown as CopilotPlugin;
    controller = new ChatSelectionHighlightController(plugin);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    cleanups.splice(0).forEach((cleanup) => cleanup());
    window.document.getSelection()!.removeAllRanges();
    window.document.body.replaceChildren();
    if (realCss) Object.defineProperty(window, "CSS", realCss);
  });

  describe("ChatSelectionHighlightController", () => {
    describe("handleActiveLeafChange()", () => {
      it("keeps the note's selected text highlighted when focus moves from the note to the chat view", () => {
        const note = openNote(BETA);
        focus(note.leaf);

        focus(leafOfType(CHAT_VIEWTYPE));

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("keeps the note's selected text highlighted when focus moves from the note to the agent chat view (https://github.com/Brevilabs/obsidian-copilot-private/issues/981)", () => {
        const note = openNote(BETA);
        focus(note.leaf);

        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("highlights the note that was already active when the plugin loaded", () => {
        const note = openNote(BETA);
        activeNote = note.leaf.view as MarkdownView;
        controller.initialize();

        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("leaves the note unhighlighted when it has no selected text", () => {
        const note = openNote();
        focus(note.leaf);

        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        expect(highlightedText(note.editor)).toBeNull();
      });

      it("keeps the highlight when focus moves from one chat view to the other", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        focus(leafOfType(CHAT_VIEWTYPE));

        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("removes the highlight when focus moves from the chat to a view that is not a chat", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        focus(leafOfType("file-explorer"));

        expect(highlightedText(note.editor)).toBeNull();
      });

      it(`keeps text selected in reading view highlighted once the chat has taken the selection (${ISSUE_983})`, () => {
        const note = openReadingNote();
        controller.initialize();
        focus(note.leaf);
        selectRendered(note.rendered, BETA);

        focusChatFromReadingNote(CHAT_AGENT_VIEWTYPE);

        expect(readingHighlightText()).toBe("beta");
      });

      it("leaves a reading view note unhighlighted after a click in it cleared the selection", () => {
        const note = openReadingNote();
        controller.initialize();
        focus(note.leaf);
        selectRendered(note.rendered, BETA);
        selectRendered(note.rendered, { anchor: 2, head: 2 });

        focusChatFromReadingNote(CHAT_AGENT_VIEWTYPE);

        expect(readingHighlightText()).toBeNull();
      });

      it("removes the reading view highlight when focus moves from the chat to a view that is not a chat", () => {
        const note = openReadingNote();
        controller.initialize();
        focus(note.leaf);
        selectRendered(note.rendered, BETA);
        focusChatFromReadingNote(CHAT_AGENT_VIEWTYPE);

        focus(leafOfType("file-explorer"));

        expect(readingHighlightText()).toBeNull();
      });

      it(`lets the chat take focus on a platform without CSS highlights, such as older iOS (${ISSUE_983})`, () => {
        const note = openReadingNote();
        controller.initialize();
        focus(note.leaf);
        selectRendered(note.rendered, BETA);
        Object.assign(window, { CSS: {} });

        expect(() => focusChatFromReadingNote(CHAT_AGENT_VIEWTYPE)).not.toThrow();
      });
    });

    describe("initialize()", () => {
      it("watches selections in a popout window opened later", () => {
        const popout = window.document.implementation.createHTMLDocument();
        controller.initialize();

        openWindow({ doc: popout });

        expect(watchedDocuments.includes(popout)).toBe(true);
      });
    });

    describe("persistFromPointerDown()", () => {
      it("highlights the active note's selected text", () => {
        const note = openNote(BETA);
        activeNote = note.leaf.view as MarkdownView;

        controller.persistFromPointerDown();

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("leaves a note that is no longer active unhighlighted", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        activeNote = null;

        controller.persistFromPointerDown();

        expect(highlightedText(note.editor)).toBeNull();
      });
    });

    describe("clearIfNoNoteContexts()", () => {
      it("keeps the highlight while a note selection is attached to the chat", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        controller.clearIfNoNoteContexts([NOTE_SELECTION_CONTEXT]);

        expect(highlightedText(note.editor)).toBe("beta");
      });

      it("removes the highlight when no note selection is attached to the chat", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        controller.clearIfNoNoteContexts([]);

        expect(highlightedText(note.editor)).toBeNull();
      });

      it("does not highlight reading view text again after its selection was removed from the chat", () => {
        const note = openReadingNote();
        controller.initialize();
        focus(note.leaf);
        selectRendered(note.rendered, BETA);
        focusChatFromReadingNote(CHAT_AGENT_VIEWTYPE);

        controller.clearIfNoNoteContexts([]);
        focus(note.leaf);
        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        expect(readingHighlightText()).toBeNull();
      });
    });

    describe("cleanup()", () => {
      it("removes the highlight", () => {
        const note = openNote(BETA);
        focus(note.leaf);
        focus(leafOfType(CHAT_AGENT_VIEWTYPE));

        controller.cleanup();

        expect(highlightedText(note.editor)).toBeNull();
      });
    });
  });

  describe("hideChatSelectionHighlight()", () => {
    it("removes the highlight from the given editor", () => {
      const note = openNote(BETA);
      focus(note.leaf);
      focus(leafOfType(CHAT_AGENT_VIEWTYPE));

      hideChatSelectionHighlight(note.editor);

      expect(highlightedText(note.editor)).toBeNull();
    });
  });
});
