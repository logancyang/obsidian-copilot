import {
  reportSelection,
  type KeyedSelection,
  type SelectionReport,
} from "@/selection/selectionStore";
import type { WebSelectedTextContext } from "@/types/message";
import { EditorView } from "@codemirror/view";
import {
  editorInfoField,
  MarkdownView,
  type App,
  type MarkdownFileInfo,
  type Plugin,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";

export function editorSelectionReport({
  editor,
  file,
}: Pick<MarkdownFileInfo, "editor" | "file">): SelectionReport | null {
  const range = editor?.listSelections()[0];
  if (!editor || !range || !file) return null;

  const content = editor.getSelection();
  if (!content.trim()) return { location: file.path, context: null };

  const [startLine, endLine] = [range.anchor.line + 1, range.head.line + 1].sort((a, b) => a - b);
  return {
    location: file.path,
    key: `${file.path}:${range.anchor.line}:${range.anchor.ch}:${range.head.line}:${range.head.ch}`,
    context: {
      id: uuidv4(),
      content,
      sourceType: "note",
      noteTitle: file.basename,
      notePath: file.path,
      startLine,
      endLine,
    },
  };
}

export function webSelectionReport(context: WebSelectedTextContext): KeyedSelection {
  return { location: context.url, key: `web:${context.url}:${context.content}`, context };
}

export function readingSelectionReport(app: App, doc: Document): SelectionReport | null {
  const selection = doc.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  if (!anchor || !focus || !file || view.getMode() !== "preview") return null;

  // Only rendered text inside the note is a note selection; a later chat
  // selection leaves the pending one attached. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
  const readingEl = view.previewMode.containerEl;
  if (!readingEl.contains(anchor) || !readingEl.contains(focus)) return null;

  const content = selection.toString();
  if (!content.trim()) return { location: file.path, context: null };

  // Rendered Markdown does not expose reliable source line numbers for every selection.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/597
  return {
    location: file.path,
    key: `preview:${file.path}:${content}`,
    context: {
      id: uuidv4(),
      content,
      sourceType: "note",
      noteTitle: file.basename,
      notePath: file.path,
      startLine: 0,
      endLine: 0,
    },
  };
}

export type InputSelectionSource = (app: App) => (() => SelectionReport) | null;

export function watchSelections(
  plugin: Plugin,
  inputSources: readonly InputSelectionSource[] = []
): void {
  let timer: number | undefined;
  const schedule = (read: () => SelectionReport | null) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const report = read();
      if (report) reportSelection(report);
    }, 500);
  };
  plugin.register(() => window.clearTimeout(timer));

  plugin.registerEditorExtension(
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet || !update.view.hasFocus) return;

      // The originating editor identifies its note even in a popout, where
      // the active leaf may differ. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
      const info = update.state.field(editorInfoField, false);
      if (info) schedule(() => editorSelectionReport(info));
    })
  );

  const readInputSources = () => {
    for (const source of inputSources) {
      const read = source(plugin.app);
      if (read) schedule(read);
    }
  };
  const watchDocument = (doc: Document) => {
    plugin.registerDomEvent(doc, "selectionchange", () => {
      const report = readingSelectionReport(plugin.app, doc);
      if (report) schedule(() => report);
    });
    // Canvas views such as Excalidraw select without a DOM selection, so they are read after each click or key.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/794
    plugin.registerDomEvent(doc, "pointerup", readInputSources);
    plugin.registerDomEvent(doc, "keyup", readInputSources);
  };
  watchDocument(activeDocument);
  plugin.registerEvent(plugin.app.workspace.on("window-open", (win) => watchDocument(win.doc)));
}
