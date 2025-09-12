import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  $setSelection,
  $createRangeSelection,
  LexicalNode,
  TextNode,
  createCommand,
  LexicalCommand,
} from "lexical";
import { TFile, App } from "obsidian";
import { $createNotePillNode } from "../NotePillPlugin";
import { $createURLPillNode } from "../URLPillNode";
import { logInfo } from "@/logger";

declare const app: App;

export interface ParsedContent {
  type: "text" | "note-pill" | "url-pill";
  content: string;
  file?: TFile;
  url?: string;
  isActive?: boolean;
}

export interface InsertTextOptions {
  enableURLPills?: boolean;
  insertAtSelection?: boolean;
}

/**
 * Sets the selection to be after the specified node
 * @param node The node to position the selection after
 */
function $setSelectionAfterNode(node: LexicalNode): void {
  if (node.getType() === "text") {
    const textNode = node as TextNode;
    const textLength = textNode.getTextContent().length;
    textNode.select(textLength, textLength);
  } else {
    // For non-text nodes (like pills), set selection after the node using parent element
    const parent = node.getParent();
    if (parent) {
      const rangeSelection = $createRangeSelection();
      const nodeIndex = node.getIndexWithinParent();
      rangeSelection.anchor.set(parent.getKey(), nodeIndex + 1, "element");
      rangeSelection.focus.set(parent.getKey(), nodeIndex + 1, "element");
      $setSelection(rangeSelection);
    }
  }
}

/**
 * Command for inserting text with automatic pill conversion from external sources
 */
export const INSERT_TEXT_WITH_PILLS_COMMAND: LexicalCommand<{
  text: string;
  options?: InsertTextOptions;
}> = createCommand("INSERT_TEXT_WITH_PILLS_COMMAND");

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
 * Parses text content to extract [[note name]] patterns and optionally URLs, converting them to appropriate pills
 * @param text The text content to parse
 * @param includeURLs Whether to process URLs in addition to note links
 * @returns Array of parsed content segments with type information
 */
export function parseTextForNotesAndURLs(text: string, includeURLs = false): ParsedContent[] {
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
 * Converts parsed content segments into Lexical nodes
 * @param segments The parsed content segments
 * @returns Array of Lexical nodes
 */
export function createNodesFromSegments(segments: ParsedContent[]): LexicalNode[] {
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

/**
 * Inserts text with automatic conversion of [[note]] references and URLs to pills.
 * This is the main API function that should be used for all programmatic text insertion.
 *
 * @param text The text to insert, which may contain [[note]] references and URLs
 * @param options Configuration options for the insertion
 */
export function $insertTextWithPills(text: string, options: InsertTextOptions = {}): void {
  const { enableURLPills = false, insertAtSelection = true } = options;

  if (!text) return;

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    logInfo("No range selection available for text insertion");
    return;
  }

  // Parse the text for note links and optionally URLs
  const segments = parseTextForNotesAndURLs(text, enableURLPills);

  // Convert segments to Lexical nodes
  const nodes = createNodesFromSegments(segments);

  if (nodes.length > 0) {
    if (insertAtSelection) {
      // Insert at current selection
      selection.insertNodes(nodes);
    } else {
      // Replace current selection with nodes
      selection.removeText();
      selection.insertNodes(nodes);
    }
  }
}

/**
 * Replaces text in a specific range with parsed content.
 * Useful for slash commands and other scenarios where you need to replace a portion of text.
 *
 * @param startOffset The start position to replace from
 * @param endOffset The end position to replace to
 * @param newText The new text content to insert with pill conversion
 * @param options Configuration options
 */
export function $replaceTextRangeWithPills(
  startOffset: number,
  endOffset: number,
  newText: string,
  options: InsertTextOptions = {}
): void {
  const { enableURLPills = false } = options;

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();

  if (anchorNode.getType() !== "text") return;

  const textNode = anchorNode as any; // TextNode
  const textContent = textNode.getTextContent();

  // Parse the new text for pills
  const segments = parseTextForNotesAndURLs(newText, enableURLPills);

  if (segments.length === 1 && segments[0].type === "text") {
    // Simple case: just text, no pills needed
    const beforeText = textContent.slice(0, startOffset);
    const afterText = textContent.slice(endOffset);
    const finalText = beforeText + segments[0].content + afterText;
    textNode.setTextContent(finalText);

    // Set cursor after inserted text
    const newOffset = beforeText.length + segments[0].content.length;
    textNode.select(newOffset, newOffset);
  } else {
    // Complex case: we have pills to insert
    const beforeText = textContent.slice(0, startOffset);
    const afterText = textContent.slice(endOffset);

    // Create nodes for the replacement
    const nodes: LexicalNode[] = [];

    // Add before text if any
    if (beforeText) {
      nodes.push($createTextNode(beforeText));
    }

    // Add parsed content nodes
    nodes.push(...createNodesFromSegments(segments));

    // Add after text if any
    if (afterText) {
      nodes.push($createTextNode(afterText));
    }

    // Replace the current text node with all new nodes
    if (nodes.length === 1 && nodes[0].getType() === "text") {
      // Simple replacement with just text
      textNode.replace(nodes[0]);
      $setSelectionAfterNode(nodes[0]);
    } else {
      // Complex replacement with multiple nodes
      for (let i = 0; i < nodes.length; i++) {
        if (i === 0) {
          textNode.replace(nodes[i]);
        } else {
          nodes[i - 1].insertAfter(nodes[i]);
        }
      }
      // Set selection after the last inserted node
      const lastNode = nodes[nodes.length - 1];
      $setSelectionAfterNode(lastNode);
    }
  }
}
