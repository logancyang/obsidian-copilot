import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  PASTE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  LexicalNode,
} from "lexical";
import { TFile, App } from "obsidian";
import { $createNotePillNode } from "../NotePillPlugin";
import { logInfo } from "@/logger";

declare const app: App;

interface ParsedContent {
  type: "text" | "note-pill";
  content: string;
  file?: TFile;
  isActive?: boolean;
}

/**
 * Parses text content to extract [[note name]] patterns and resolve them to actual notes
 * @param text The text content to parse
 * @returns Array of parsed content segments with type information
 */
function parseTextForNoteLinks(text: string): ParsedContent[] {
  const segments: ParsedContent[] = [];
  const noteLinkRegex = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = noteLinkRegex.exec(text)) !== null) {
    // Add any text before the match
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    const noteName = match[1].trim();
    const file = resolveNoteReference(noteName);

    if (file && file instanceof TFile) {
      // Valid note reference - create pill
      const activeNote = app?.workspace.getActiveFile();
      const isActive = activeNote?.path === file.path;

      segments.push({
        type: "note-pill",
        content: file.basename,
        file: file,
        isActive: isActive,
      });
    } else {
      // Invalid note reference - keep as plain text
      segments.push({
        type: "text",
        content: match[0], // Keep the full [[note name]] syntax
      });
    }

    lastIndex = noteLinkRegex.lastIndex;
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Attempts to resolve a note reference to a TFile
 * @param noteName The name of the note to resolve
 * @returns TFile if found, null otherwise
 */
function resolveNoteReference(noteName: string): TFile | null {
  if (!app?.vault || !app?.metadataCache) {
    return null;
  }

  try {
    // Try to resolve using Obsidian's link resolution
    const file = app.metadataCache.getFirstLinkpathDest(noteName, "");

    if (file && file instanceof TFile) {
      return file;
    }

    // Fallback: try with .md extension if not already present
    if (!noteName.endsWith(".md")) {
      const fileWithExt = app.metadataCache.getFirstLinkpathDest(noteName + ".md", "");
      if (fileWithExt && fileWithExt instanceof TFile) {
        return fileWithExt;
      }
    }

    // Another fallback: search by basename
    const markdownFiles = app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      if (file.basename === noteName || file.name === noteName) {
        return file;
      }
    }

    return null;
  } catch (error) {
    logInfo("Error resolving note reference:", error);
    return null;
  }
}

/**
 * Converts parsed content segments into Lexical nodes
 * @param segments The parsed content segments
 * @returns Array of Lexical nodes
 */
function createNodesFromSegments(segments: ParsedContent[]): LexicalNode[] {
  const nodes: LexicalNode[] = [];

  for (const segment of segments) {
    if (segment.type === "text" && segment.content) {
      nodes.push($createTextNode(segment.content));
    } else if (segment.type === "note-pill" && segment.file) {
      nodes.push(
        $createNotePillNode(segment.content, segment.file.path, segment.isActive || false)
      );
    }
  }

  return nodes;
}

/**
 * Lexical plugin that processes pasted text to convert [[note name]] patterns into note pills.
 * Only converts patterns that resolve to actual notes in the vault - invalid references
 * are left as plain text.
 */
export function PastePlugin(): null {
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
        if (!plainText || !plainText.includes("[[")) {
          // No note links detected, let default paste behavior handle it
          return false;
        }

        logInfo("PastePlugin processing text with note links:", plainText);

        // Parse the text for note links
        const segments = parseTextForNoteLinks(plainText);

        // Check if we found any valid note pills
        const hasValidNotes = segments.some((segment) => segment.type === "note-pill");

        if (!hasValidNotes) {
          // No valid note references found, let default paste behavior handle it
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
  }, [editor]);

  return null;
}
