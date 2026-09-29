import { isAllowedFileForNoteContext } from "@/utils";
import { App, Notice, TFile } from "obsidian";
import { RefObject, useEffect, useState } from "react";

export interface UseChatFileDropProps {
  app: App;
  contextNotes: TFile[];
  setContextNotes: (notes: TFile[] | ((prev: TFile[]) => TFile[])) => void;
  selectedImages: File[];
  onAddImage: (files: File[]) => void;
  containerRef: RefObject<HTMLElement>;
}

export interface UseChatFileDropReturn {
  isDragActive: boolean;
}

function parseObsidianUri(app: App, uriString: string): TFile | null {
  const match = uriString.match(/obsidian:\/\/open\?vault=.*?&file=(.*)$/);
  if (!match) return null;

  const filePath = decodeURIComponent(match[1]);

  let file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) return file;

  file = app.vault.getAbstractFileByPath(filePath + ".md");
  if (file instanceof TFile) return file;

  return null;
}

function parseObsidianUris(app: App, uriString: string): TFile[] {
  const lines = uriString.split("\n").filter((line) => line.trim());

  const files: TFile[] = [];
  for (const line of lines) {
    const file = parseObsidianUri(app, line.trim());
    if (file) {
      files.push(file);
    }
  }

  return files;
}

function getImageMimeType(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === "jpg") return "image/jpeg";
  return `image/${normalized}`;
}

export function useChatFileDrop(props: UseChatFileDropProps): UseChatFileDropReturn {
  const { app, contextNotes, setContextNotes, selectedImages, onAddImage, containerRef } = props;
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

    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("[data-copilot-drop-zone]")) return;
      e.preventDefault();

      setIsDragActive(false);

      const items = e.dataTransfer.items;
      const stringItems: DataTransferItem[] = [];
      const fileItems: DataTransferItem[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "string") {
          stringItems.push(item);
        } else if (item.kind === "file") {
          fileItems.push(item);
        }
      }

      if (stringItems.length > 0) {
        e.stopPropagation();

        const uriStringPromises = stringItems.map(
          (item) =>
            new Promise<string>((resolve) => {
              item.getAsString((data) => resolve(data));
            })
        );

        const uriStrings = await Promise.all(uriStringPromises);

        const fileMap = new Map<string, TFile>();
        for (const uriString of uriStrings) {
          const files = parseObsidianUris(app, uriString);
          for (const file of files) {
            fileMap.set(file.path, file);
          }
        }

        for (const file of fileMap.values()) {
          const isImage = ["png", "gif", "jpeg", "jpg", "webp"].includes(file.extension);

          if (isImage) {
            const isDuplicate = selectedImages.some((img) => img.name === file.name);
            if (isDuplicate) {
              new Notice("This image is already in the context");
              continue;
            }

            const arrayBuffer = await app.vault.readBinary(file);
            const blob = new Blob([arrayBuffer]);
            const imageFile = new File([blob], file.name, {
              type: getImageMimeType(file.extension),
            });
            onAddImage([imageFile]);
          } else if (isAllowedFileForNoteContext(file)) {
            const isDuplicate = contextNotes.some((note) => note.path === file.path);
            if (isDuplicate) {
              new Notice("This note is already in the context");
              continue;
            }

            setContextNotes((prev) => [...prev, file]);
          } else {
            new Notice(
              `Unsupported file type: ${file.extension}. Supported types: md, pdf, canvas, and images.`
            );
          }
        }
      } else if (fileItems.length > 0) {
        const files: File[] = [];

        for (const item of fileItems) {
          const file = item.getAsFile();
          if (file && file.type.startsWith("image/")) {
            files.push(file);
          }
        }

        if (files.length > 0) {
          onAddImage(files);
        }
      }
    };

    const handleDropEvent = (e: DragEvent) => {
      void handleDrop(e);
    };

    const handleDropCaptureCleanup = () => setIsDragActive(false);

    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDropEvent);
    container.addEventListener("drop", handleDropCaptureCleanup, true);

    return () => {
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDropEvent);
      container.removeEventListener("drop", handleDropCaptureCleanup, true);
    };
  }, [app, contextNotes, selectedImages, onAddImage, setContextNotes, containerRef]);

  return { isDragActive };
}
