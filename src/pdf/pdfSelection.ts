import type { SelectionReport } from "@/selection/selectionStore";
import { FileView, type App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

// Obsidian's PDF viewer renders a selectable text layer, so its selections attach like Reading view's.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/818
export function activePdfSelection(app: App): (() => SelectionReport) | null {
  const view = app.workspace.getActiveViewOfType(FileView);
  const file = view?.file;
  if (!view || !file || view.getViewType() !== "pdf") return null;
  return () => {
    const { contentEl } = view;
    const selection = contentEl.ownerDocument.getSelection();
    const inPdf =
      selection?.anchorNode &&
      contentEl.contains(selection.anchorNode) &&
      contentEl.contains(selection.focusNode);
    const content = inPdf ? selection.toString() : "";
    if (!content.trim()) return { location: file.path, context: null };
    return {
      location: file.path,
      key: `pdf:${file.path}:${content}`,
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
  };
}
