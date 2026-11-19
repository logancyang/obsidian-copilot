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

const NOTE_TEXT = "Alpha beta gamma";
const BETA = { anchor: 6, head: 10 };

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
  let activeNote: MarkdownView | null;
  let controller: ChatSelectionHighlightController;

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
    });
    const leaf = { view, getViewState: () => ({ type: "markdown" }) } as unknown as WorkspaceLeaf;
    view.leaf = leaf;
    return { leaf, editor };
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
    const plugin = {
      app: { workspace: { getActiveViewOfType: () => activeNote } },
    } as unknown as CopilotPlugin;
    controller = new ChatSelectionHighlightController(plugin);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
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
