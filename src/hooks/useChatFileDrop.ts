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
 * Helper function to parse Obsidian URI and extract file path
 * @param uriString - The URI string to parse
 * @returns The file path, or null if parsing failed
 */
function parseObsidianUri(uriString: string): string | null {
  // Parse Obsidian URI format: obsidian://open?vault=...&file=...
  const match = uriString.match(/obsidian:\/\/open\?vault=.*?&file=(.*)$/);
  if (match) {
    let filePath = decodeURIComponent(match[1]);
    // Obsidian URIs for markdown files may omit the .md extension
    if (!filePath.includes(".")) {
      filePath += ".md";
    }
    return filePath;
  }
  return null;
}

/**
 * Parse multiple Obsidian URIs from a newline-separated string.
 * This handles the case where multiple files are dropped from the nav bar,
 * which come as a single string with URIs separated by newlines.
 * @param uriString - String potentially containing multiple URIs
 * @returns Array of file paths
 */
function parseObsidianUris(uriString: string): string[] {
  // Split by newlines and filter empty lines
  const lines = uriString.split("\n").filter((line) => line.trim());

  // Parse each line as a URI
  const filePaths: string[] = [];
  for (const line of lines) {
    const filePath = parseObsidianUri(line.trim());
    if (filePath) {
      filePaths.push(filePath);
    }
  }

  return filePaths;
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

      // Track processed file paths to avoid duplicates when multiple string items
      // contain the same file (Obsidian sometimes includes multiple formats)
      const processedPaths = new Set<string>();

      // Process Obsidian URI strings from nav bar
      if (stringItems.length > 0) {
        // Stop propagation to prevent other handlers from processing the same drop
        e.stopPropagation();

        for (const item of stringItems) {
          item.getAsString(async (data) => {
            // Parse URIs - handles both single and multiple files
            const filePaths = parseObsidianUris(data);

            // Process each file path
            for (const filePath of filePaths) {
              // Skip if we've already processed this file path
              if (processedPaths.has(filePath)) continue;
              processedPaths.add(filePath);

              const file = app.vault.getAbstractFileByPath(filePath);

              // Ensure file exists and is a TFile
              if (!(file instanceof TFile)) {
                new Notice("File not found in vault");
                continue;
              }

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
          });
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
  }, [app.vault, contextNotes, selectedImages, onAddImage, setContextNotes, containerRef]);

  return { isDragActive };
}
