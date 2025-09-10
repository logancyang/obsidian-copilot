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
import { $createURLPillNode } from "../URLPillNode";
import { logInfo } from "@/logger";

declare const app: App;

interface ParsedContent {
  type: "text" | "note-pill" | "url-pill";
  content: string;
  file?: TFile;
  url?: string;
  isActive?: boolean;
}

/**
 * Validates if a string is a valid URL
 * @param string The string to validate
 * @returns True if the string is a valid URL
 */
function isValidURL(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses text content to extract [[note name]] patterns and optionally URLs, converting them to appropriate pills
 * @param text The text content to parse
 * @param includeURLs Whether to process URLs in addition to note links
 * @returns Array of parsed content segments with type information
 */
function parseTextForNotesAndURLs(text: string, includeURLs = false): ParsedContent[] {
  const segments: ParsedContent[] = [];
  // Use different regex based on whether URLs should be processed
  const regex = includeURLs
    ? /(\[\[([^\]]+)\]\])|(https?:\/\/[^\s"'<>]+)/g // Notes and URLs
    : /\[\[([^\]]+)\]\]/g; // Notes only
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add any text before the match
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        segments.push({
          type: "text",
          content: textContent,
        });
      }
    }

    if (includeURLs && match[1]) {
      // This is a note link [[note name]] (when using combined regex)
      const noteName = match[2].trim();
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
    } else if (includeURLs && match[3]) {
      // This is a URL (when using combined regex)
      const url = match[3].replace(/,+$/, ""); // Remove trailing commas
      if (isValidURL(url)) {
        segments.push({
          type: "url-pill",
          content: url,
          url: url,
        });
      } else {
        // Invalid URL - keep as plain text
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (!includeURLs && match[1]) {
      // This is a note link [[note name]] (when using notes-only regex)
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
    }

    lastIndex = regex.lastIndex;
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      segments.push({
        type: "text",
        content: remainingText,
      });
    }
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
    } else if (segment.type === "url-pill" && segment.url) {
      nodes.push($createURLPillNode(segment.url));
    }
  }

  return nodes;
}

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
