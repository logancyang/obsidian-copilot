import { useCallback } from "react";
import { TFile } from "obsidian";

/**
 * Returns a drag-start handler that integrates with Obsidian's native dragManager API.
 * When a note element is dropped onto the Obsidian editor, the editor automatically
 * inserts the corresponding `[[wikilink]]` without any additional drop handler.
 *
 * Usage:
 * ```tsx
 * const handleDragStart = useNoteDrag();
 * const file = app.vault.getAbstractFileByPath(path);
 * if (file instanceof TFile) {
 *   <div draggable onDragStart={(e) => handleDragStart(e, file)}> ... </div>
 * }
 * ```
 */
export function useNoteDrag() {
  const handleDragStart = useCallback((e: React.DragEvent, file: TFile): void => {
    const dragManager = (
      app as unknown as {
        dragManager?: {
          dragLink: (event: DragEvent, linkText: string) => unknown;
          onDragStart: (event: DragEvent, data: unknown) => void;
        };
      }
    ).dragManager;
    if (!dragManager) return;

    // Mark this drag as internal so the chat drop zone overlay doesn't appear
    e.dataTransfer.setData("copilot/internal-drag", "true");

    const linkText = app.metadataCache.fileToLinktext(file, "");
    const dragData = dragManager.dragLink(e.nativeEvent, linkText);
    dragManager.onDragStart(e.nativeEvent, dragData);
  }, []);

  return handleDragStart;
}
