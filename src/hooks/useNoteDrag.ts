import { useCallback } from "react";
import { TFile } from "obsidian";
import { useApp } from "@/context";

export function useNoteDrag() {
  const app = useApp();
  const handleDragStart = useCallback(
    (e: React.DragEvent, file: TFile): void => {
      const dragManager = (
        app as unknown as {
          dragManager?: {
            dragLink: (event: DragEvent, linkText: string) => unknown;
            onDragStart: (event: DragEvent, data: unknown) => void;
          };
        }
      ).dragManager;
      if (!dragManager) return;

      e.dataTransfer.setData("copilot/internal-drag", "true");

      const linkText = app.metadataCache.fileToLinktext(file, "");
      const dragData = dragManager.dragLink(e.nativeEvent, linkText);
      dragManager.onDragStart(e.nativeEvent, dragData);
    },
    [app]
  );

  return handleDragStart;
}
