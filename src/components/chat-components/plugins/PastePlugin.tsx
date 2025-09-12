import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";
import { parseTextForNotesAndURLs, createNodesFromSegments } from "../utils/lexicalTextUtils";

interface PastePluginProps {
  enableURLPills?: boolean;
}

/**
 * Lexical plugin that processes pasted text to convert [[note name]] patterns and URLs into pills.
 * Only converts patterns that resolve to actual notes in the vault and valid URLs - invalid references
 * are left as plain text.
 */
export function PastePlugin({ enableURLPills = false }: PastePluginProps): null {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }

        const plainText = clipboardData.getData("text/plain");
        const hasNoteLinks = plainText.includes("[[");
        const hasURLs = enableURLPills && plainText.includes("http");

        if (!plainText || (!hasNoteLinks && !hasURLs)) {
          // No note links or URLs detected, let default paste behavior handle it
          return false;
        }

        // Parse the text for note links and conditionally URLs
        const segments = parseTextForNotesAndURLs(plainText, enableURLPills);

        // Check if we found any valid pills
        const hasValidPills = segments.some(
          (segment) =>
            segment.type === "note-pill" || (enableURLPills && segment.type === "url-pill")
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
  }, [editor, enableURLPills]);

  return null;
}
