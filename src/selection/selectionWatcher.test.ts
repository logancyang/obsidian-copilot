jest.mock("obsidian", () => {
  const actual = jest.requireActual<Record<string, unknown>>("obsidian");
  const { StateField } =
    jest.requireActual<typeof import("@codemirror/state")>("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define<unknown>({ create: () => null, update: (value) => value }),
    MarkdownView: class MarkdownView {},
  };
});

import { clearSelection, getSelectedTextContexts } from "@/selection/selectionStore";
import {
  editorSelectionReport,
  readingSelectionReport,
  watchSelections,
} from "@/selection/selectionWatcher";
import type { Extension, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, type App, type MarkdownFileInfo, type Plugin } from "obsidian";

const ISSUE_597 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/597";

const research = { path: "Research.md", basename: "Research" };

function readingNote(text: string) {
  const preview = document.createElement("div");
  preview.textContent = text;
  document.body.append(preview);
  const view = { file: research, getMode: () => "preview", previewMode: { containerEl: preview } };
  const app = { workspace: { getActiveViewOfType: () => view, on: jest.fn() } } as unknown as App;
  return { preview, app };
}

function selectText(node: Node, end: number): void {
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("selectionWatcher", () => {
  beforeEach(() => clearSelection());
  afterEach(() => {
    document.getSelection()!.removeAllRanges();
    document.body.replaceChildren();
  });

  describe("editorSelectionReport()", () => {
    it("reports the selected text with 1-based lines in order, whichever way it was dragged", () => {
      const report = editorSelectionReport({
        file: research,
        editor: {
          listSelections: () => [{ anchor: { line: 2, ch: 7 }, head: { line: 1, ch: 0 } }],
          getSelection: () => "An excerpt from the note.",
        },
      } as unknown as MarkdownFileInfo);

      expect(report).toMatchObject({
        location: "Research.md",
        key: "Research.md:2:7:1:0",
        context: {
          content: "An excerpt from the note.",
          sourceType: "note",
          notePath: "Research.md",
          startLine: 2,
          endLine: 3,
        },
      });
    });

    it("reports nothing selected in the note for a bare cursor", () => {
      const report = editorSelectionReport({
        file: research,
        editor: {
          listSelections: () => [{ anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 4 } }],
          getSelection: () => "",
        },
      } as unknown as MarkdownFileInfo);

      expect(report).toEqual({
        location: "Research.md",
        key: "Research.md:0:4:0:4",
        context: null,
      });
    });
  });

  describe("readingSelectionReport()", () => {
    it(`reports rendered note text without source lines (${ISSUE_597})`, () => {
      const { preview, app } = readingNote("Excerpt from the note");
      selectText(preview.firstChild!, 7);

      expect(readingSelectionReport(app, document)).toMatchObject({
        location: "Research.md",
        key: "preview:Research.md:Excerpt",
        context: { content: "Excerpt", startLine: 0, endLine: 0 },
      });
    });

    it(`reports nothing for a selection outside the rendered note, such as in chat (${ISSUE_597})`, () => {
      const { app } = readingNote("Excerpt from the note");
      const chat = document.createElement("div");
      chat.textContent = "Chat input";
      document.body.append(chat);
      selectText(chat.firstChild!, 4);

      expect(readingSelectionReport(app, document)).toBeNull();
    });
  });

  describe("watchSelections()", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function fakePlugin(app: App) {
      let extension: Extension | undefined;
      const cleanups: Array<() => void> = [];
      const plugin = {
        app,
        register: (cleanup: () => void) => cleanups.push(cleanup),
        registerEditorExtension: (value: Extension) => {
          extension = value;
        },
        registerDomEvent: (doc: Document, event: string, handler: EventListener) => {
          doc.addEventListener(event, handler);
          cleanups.push(() => doc.removeEventListener(event, handler));
        },
        registerEvent: jest.fn(),
      } as unknown as Plugin;
      return { plugin, extension: () => extension!, unload: () => cleanups.forEach((c) => c()) };
    }

    it(`attaches Reading view text after the debounce even when chat takes the selection first, then clears it in the note (${ISSUE_597})`, () => {
      const { preview, app } = readingNote("Excerpt from the note");
      const chat = document.createElement("div");
      chat.textContent = "Chat input";
      document.body.append(chat);
      const { plugin, unload } = fakePlugin(app);

      watchSelections(plugin);
      selectText(preview.firstChild!, 7);
      selectText(chat.firstChild!, 0);
      expect(getSelectedTextContexts()).toEqual([]);
      jest.advanceTimersByTime(500);
      expect(getSelectedTextContexts()).toEqual([
        expect.objectContaining({ content: "Excerpt", notePath: "Research.md" }),
      ]);

      selectText(preview.firstChild!, 0);
      jest.advanceTimersByTime(500);
      expect(getSelectedTextContexts()).toEqual([]);
      unload();
    });

    it(`attaches and clears a note excerpt from the focused editor's own note after the debounce (${ISSUE_597})`, () => {
      const { plugin, extension, unload } = fakePlugin({
        workspace: { on: jest.fn() },
      } as unknown as App);
      watchSelections(plugin);
      const noteInfo = {
        file: research,
        editor: {
          listSelections: () => [
            {
              anchor: { line: 0, ch: cm.state.selection.main.anchor },
              head: { line: 0, ch: cm.state.selection.main.head },
            },
          ],
          getSelection: () =>
            cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to),
        },
      } as unknown as MarkdownFileInfo;
      const cm = new EditorView({
        doc: "Excerpt from the note",
        parent: document.body,
        extensions: [
          extension(),
          (editorInfoField as unknown as StateField<unknown>).init(() => noteInfo),
        ],
      });

      cm.focus();
      cm.dispatch({ selection: { anchor: 0, head: 3 } });
      cm.dispatch({ selection: { anchor: 0, head: 7 } });
      jest.advanceTimersByTime(500);
      expect(getSelectedTextContexts()).toEqual([
        expect.objectContaining({ content: "Excerpt", notePath: "Research.md" }),
      ]);

      cm.dispatch({ selection: { anchor: 7 } });
      jest.advanceTimersByTime(500);
      expect(getSelectedTextContexts()).toEqual([]);
      cm.destroy();
      unload();
    });

    it("drops a pending selection update when the plugin unloads", () => {
      const { preview, app } = readingNote("Excerpt from the note");
      const { plugin, unload } = fakePlugin(app);

      watchSelections(plugin);
      selectText(preview.firstChild!, 12);
      unload();
      jest.advanceTimersByTime(500);

      expect(getSelectedTextContexts()).toEqual([]);
    });
  });
});
