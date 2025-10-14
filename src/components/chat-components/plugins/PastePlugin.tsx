import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";
import { parseTextForPills, createNodesFromSegments } from "../utils/lexicalTextUtils";

interface PastePluginProps {
  enableURLPills?: boolean;
  onImagePaste?: (files: File[]) => void;
}

/**
 * Lexical plugin that processes pasted text to convert [[note name]], @tool, #tag, {folder} patterns and URLs into pills.
 * Only converts patterns that resolve to actual notes in the vault, valid tools, valid tags, valid folders, and valid URLs -
 * invalid references are left as plain text.
 */
export function PastePlugin({ enableURLPills = false, onImagePaste }: PastePluginProps): null {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }

        // First, check for image data
        if (onImagePaste) {
          const items = clipboardData.items;
          if (items) {
            const imageItems = Array.from(items).filter(
              (item) => item.type.indexOf("image") !== -1
            );

            if (imageItems.length > 0) {
              event.preventDefault();

              // Handle image processing asynchronously
              Promise.all(
                imageItems.map((item) => {
                  const file = item.getAsFile();
                  return file;
                })
              ).then((files) => {
                const validFiles = files.filter((file) => file !== null);
                if (validFiles.length > 0) {
                  onImagePaste(validFiles);
                }
              });

              return true;
            }
          }
        }

        const plainText = clipboardData.getData("text/plain");
        const hasNoteLinks = plainText.includes("[[");
        const hasURLs = enableURLPills && plainText.includes("http");
        const hasTools = plainText.includes("@");
        const hasTags = plainText.includes("#");
        const hasFolders = plainText.includes("{") && plainText.includes("}");

        if (!plainText || (!hasNoteLinks && !hasURLs && !hasTools && !hasTags && !hasFolders)) {
          // No note links, URLs, tools, tags, or folders detected, let default paste behavior handle it
          return false;
        }

        // Parse the text for all pill types
        const segments = parseTextForPills(plainText, {
          includeNotes: true,
          includeURLs: enableURLPills,
          includeTools: true,
          includeCustomTemplates: true,
        });

        // Check if we found any valid pills
        const hasValidPills = segments.some(
          (segment) =>
            segment.type === "note-pill" ||
            segment.type === "active-note-pill" ||
            (enableURLPills && segment.type === "url-pill") ||
            segment.type === "tool-pill" ||
            segment.type === "folder-pill"
        );

        if (!hasValidPills) {
          // No valid references found, let default paste behavior handle it
          return false;
        }

        // Prevent default paste behavior
        event.preventDefault();

        // Insert the processed content
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            return;
          }

          const nodes = createNodesFromSegments(segments);
          if (nodes.length > 0) {
            selection.insertNodes(nodes);
          }
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, enableURLPills, onImagePaste]);

  return null;
}
