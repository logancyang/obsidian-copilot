import { isAllowedFileForNoteContext } from "@/utils";
import { App, Notice, TFile } from "obsidian";
import { RefObject, useEffect, useState } from "react";

/**
 * Props for the useChatFileDrop hook
 */
export interface UseChatFileDropProps {
  /** Obsidian app instance for vault operations */
  app: App;
  /** Current context notes */
  contextNotes: TFile[];
  /** Callback to update context notes */
  setContextNotes: (notes: TFile[] | ((prev: TFile[]) => TFile[])) => void;
  /** Currently selected images */
  selectedImages: File[];
  /** Callback to add images */
  onAddImage: (files: File[]) => void;
  /** Reference to the container element for drag-and-drop */
  containerRef: RefObject<HTMLElement>;
}

/**
 * Return value from the useChatFileDrop hook
 */
export interface UseChatFileDropReturn {
  /** Whether a file is currently being dragged over the container */
  isDragActive: boolean;
}

/**
 * Helper function to parse Obsidian URI and resolve to a TFile.
 * Uses the file system as source of truth: tries loading the file path directly,
 * and if that fails, tries adding .md extension (for markdown files without extension).
 * @param app - The Obsidian app instance
 * @param uriString - The URI string to parse
 * @returns The resolved TFile, or null if file not found
 */
function parseObsidianUri(app: App, uriString: string): TFile | null {
  // Parse Obsidian URI format: obsidian://open?vault=...&file=...
  const match = uriString.match(/obsidian:\/\/open\?vault=.*?&file=(.*)$/);
  if (!match) return null;

  const filePath = decodeURIComponent(match[1]);

  // Try 1: Load file as-is (works for images, pdfs, canvas, and .md files)
  let file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) return file;

  // Try 2: Add .md extension (for markdown files without extension in URI)
  file = app.vault.getAbstractFileByPath(filePath + ".md");
  if (file instanceof TFile) return file;

  // Give up - file not found
  return null;
}

/**
 * Parse multiple Obsidian URIs from a newline-separated string.
 * This handles the case where multiple files are dropped from the nav bar,
 * which come as a single string with URIs separated by newlines.
 * @param app - The Obsidian app instance
 * @param uriString - String potentially containing multiple URIs
 * @returns Array of resolved TFile objects
 */
function parseObsidianUris(app: App, uriString: string): TFile[] {
  // Split by newlines and filter empty lines
  const lines = uriString.split("\n").filter((line) => line.trim());

  // Parse each line as a URI and collect resolved files
  const files: TFile[] = [];
  for (const line of lines) {
    const file = parseObsidianUri(app, line.trim());
    if (file) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Custom hook to handle drag-and-drop of files into the chat.
 * Supports:
 * - Dropping files from Obsidian nav bar (md, pdf, canvas, images)
 * - Dropping external image files
 *
 * @param props - Configuration for the drag-and-drop functionality
 * @returns Object containing drag state
 */
export function useChatFileDrop(props: UseChatFileDropProps): UseChatFileDropReturn {
  const { app, contextNotes, setContextNotes, selectedImages, onAddImage, containerRef } = props;
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /**
     * Handle dragover event to show visual feedback
     */
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";

        // Check if we have string items (Obsidian nav bar drag) or file items (external files)
        const hasStringItems = Array.from(e.dataTransfer.items).some(
          (item) => item.kind === "string"
        );
        const hasFileItems = Array.from(e.dataTransfer.items).some((item) => item.kind === "file");

        if (hasStringItems || hasFileItems) {
          setIsDragActive(true);
        }
      }
    };

    /**
     * Handle dragleave event to clear visual feedback
     */
    const handleDragLeave = (e: DragEvent) => {
      // Check if we're actually leaving the container (not just entering a child)
      const rect = container.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      // If mouse is outside the container bounds, clear drag state
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        setIsDragActive(false);
      }
    };

    /**
     * Handle drop event to process dropped files
     */
    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();

      // Clear drag state
      setIsDragActive(false);

      const items = e.dataTransfer.items;
      const stringItems: DataTransferItem[] = [];
      const fileItems: DataTransferItem[] = [];

      // Separate string items (Obsidian nav bar) from file items (external files)
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "string") {
          stringItems.push(item);
        } else if (item.kind === "file") {
          fileItems.push(item);
        }
      }

      // Process Obsidian URI strings from nav bar
      if (stringItems.length > 0) {
        // Stop propagation to prevent other handlers from processing the same drop
        e.stopPropagation();

        // Collect all URI strings first to avoid race conditions
        // getAsString is async and multiple callbacks could run concurrently
        const uriStringPromises = stringItems.map(
          (item) =>
            new Promise<string>((resolve) => {
              item.getAsString((data) => resolve(data));
            })
        );

        const uriStrings = await Promise.all(uriStringPromises);

        // Parse all URIs and collect unique files (deduplicate by path)
        const fileMap = new Map<string, TFile>();
        for (const uriString of uriStrings) {
          const files = parseObsidianUris(app, uriString);
          for (const file of files) {
            fileMap.set(file.path, file);
          }
        }

        // Now process each unique file sequentially
        for (const file of fileMap.values()) {
          // Check if it's an image file
          const isImage = ["png", "gif", "jpeg", "jpg", "webp"].includes(file.extension);

          if (isImage) {
            // Handle as image
            // Check for duplicate images
            const isDuplicate = selectedImages.some((img) => img.name === file.name);
            if (isDuplicate) {
              new Notice("This image is already in the context");
              continue;
            }

            // Read file as File object for image handling
            const arrayBuffer = await app.vault.readBinary(file);
            const blob = new Blob([arrayBuffer]);
            const imageFile = new File([blob], file.name, {
              type: `image/${file.extension}`,
            });
            onAddImage([imageFile]);
          } else if (isAllowedFileForNoteContext(file)) {
            // Handle as note (md, pdf, canvas)
            // Check for duplicate notes
            const isDuplicate = contextNotes.some((note) => note.path === file.path);
            if (isDuplicate) {
              new Notice("This note is already in the context");
              continue;
            }

            // Add to context notes
            setContextNotes((prev) => [...prev, file]);
          } else {
            // Unsupported file type
            new Notice(
              `Unsupported file type: ${file.extension}. Supported types: md, pdf, canvas, and images.`
            );
          }
        }
      } else if (fileItems.length > 0) {
        // Process external file drops (images only)
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

    // Attach event listeners
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDrop);

    // Cleanup
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDrop);
    };
  }, [app, contextNotes, selectedImages, onAddImage, setContextNotes, containerRef]);

  return { isDragActive };
}
