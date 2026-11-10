import { attachToChat } from "@/components/chat-components/attachToChat";
import { splitByVault } from "@/utils/splitByVault";
import { App, TFile } from "obsidian";
import { RefObject, useEffect, useState } from "react";

export interface UseChatFileDropProps {
  app: App;
  contextNotes: TFile[];
  setContextNotes: (notes: TFile[] | ((prev: TFile[]) => TFile[])) => void;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  containerRef: RefObject<HTMLElement>;
  acceptAnyFileType?: boolean;
}

export interface UseChatFileDropReturn {
  isDragActive: boolean;
}

export function useChatFileDrop(props: UseChatFileDropProps): UseChatFileDropReturn {
  const {
    app,
    contextNotes,
    setContextNotes,
    selectedImages,
    onAddImage,
    containerRef,
    acceptAnyFileType = false,
  } = props;
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDragOver = (e: DragEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("[data-copilot-drop-zone]")) {
        setIsDragActive(false);
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";

        if (e.dataTransfer.types.includes("copilot/internal-drag")) {
          return;
        }

        const hasStringItems = Array.from(e.dataTransfer.items).some(
          (item) => item.kind === "string"
        );
        const hasFileItems = Array.from(e.dataTransfer.items).some((item) => item.kind === "file");

        if (hasStringItems || hasFileItems) {
          setIsDragActive(true);
        }
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        setIsDragActive(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("[data-copilot-drop-zone]")) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);
      void attachToChat(app, splitByVault(app, e.dataTransfer), {
        contextNotes,
        selectedImages,
        onAddImage,
        setContextNotes,
        acceptAnyFileType,
      });
    };

    const handleDropCaptureCleanup = () => setIsDragActive(false);

    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDrop);
    container.addEventListener("drop", handleDropCaptureCleanup, true);

    return () => {
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDrop);
      container.removeEventListener("drop", handleDropCaptureCleanup, true);
    };
  }, [
    app,
    contextNotes,
    selectedImages,
    onAddImage,
    setContextNotes,
    containerRef,
    acceptAnyFileType,
  ]);

  return { isDragActive };
}
