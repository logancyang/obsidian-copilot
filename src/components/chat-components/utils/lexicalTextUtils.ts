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
import { TFile, TFolder, App } from "obsidian";
import { $createNotePillNode } from "../NotePillPlugin";
import { $createURLPillNode } from "../URLPillNode";
import { $createToolPillNode } from "../ToolPillNode";
import { $createTagPillNode } from "../TagPillNode";
import { $createFolderPillNode } from "../FolderPillNode";
import { logInfo } from "@/logger";
import { AVAILABLE_TOOLS } from "../constants/tools";

declare const app: App;

export type PillType = "notes" | "tools" | "folders" | "tags";

export interface PillData {
  type: PillType;
  title: string;
  data: TFile | TFolder | string;
}

/**
 * Generic function to create pill nodes based on type and data
 */
export function $createPillNode(pillData: PillData) {
  const { type, title, data } = pillData;

  switch (type) {
    case "notes":
      if (data instanceof TFile) {
        const activeNote = app?.workspace.getActiveFile();
        const isActive = activeNote?.path === data.path;
        return $createNotePillNode(title, data.path, isActive);
      }
      break;
    case "tools":
      if (typeof data === "string") {
        return $createToolPillNode(data);
      }
      break;
    case "folders":
      if (data instanceof TFolder) {
        return $createFolderPillNode(data.name, data.path);
      }
      break;
    case "tags":
      if (typeof data === "string") {
        return $createTagPillNode(data);
      }
      break;
  }

  throw new Error(`Invalid pill data: ${JSON.stringify(pillData)}`);
}

export interface ParsedContent {
  type: "text" | "note-pill" | "url-pill" | "tool-pill" | "tag-pill" | "folder-pill";
  content: string;
  file?: TFile;
  url?: string;
  toolName?: string;
  tagName?: string;
  folder?: TFolder;
  isActive?: boolean;
}

export interface InsertTextOptions {
  enableURLPills?: boolean;
  enableToolPills?: boolean;
  enableTagPills?: boolean;
  insertAtSelection?: boolean;
}

/**
 * Splits text at a given range into before and after segments
 * @param text The text to split
 * @param startOffset The start position
 * @param endOffset The end position
 * @returns Object with beforeText and afterText
 */
function splitTextAtRange(
  text: string,
  startOffset: number,
  endOffset: number
): { beforeText: string; afterText: string } {
  return {
    beforeText: text.slice(0, startOffset),
    afterText: text.slice(endOffset),
  };
}

/**
 * Replaces a text node with multiple nodes and sets selection appropriately
 * @param textNode The text node to replace
 * @param nodes The nodes to replace it with
 * @param setCursorAfter Whether to set cursor after the replacement
 */
function $replaceTextNodeWithNodes(
  textNode: TextNode,
  nodes: LexicalNode[],
  setCursorAfter: boolean = true
): void {
  if (nodes.length === 1 && nodes[0].getType() === "text") {
    // Simple replacement with just text
    textNode.replace(nodes[0]);
    if (setCursorAfter) {
      $setSelectionAfterNode(nodes[0]);
    }
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
    if (setCursorAfter && nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      $setSelectionAfterNode(lastNode);
    }
  }
}

/**
 * Inserts a pill node with optional space after, handling both replacement and insertion scenarios
 * @param anchorNode The anchor text node
 * @param beforeText Text that comes before the pill
 * @param pillNode The pill node to insert
 * @param afterText Text that comes after the pill
 * @param addSpace Whether to add a space after the pill
 */
function $insertPillWithOptionalSpace(
  anchorNode: TextNode,
  beforeText: string,
  pillNode: LexicalNode,
  afterText: string,
  addSpace: boolean
): void {
  // Calculate the space and after text combination
  const spaceAndAfter = addSpace ? (afterText ? " " + afterText : " ") : afterText;

  if (beforeText) {
    // Replace node content with before text, then insert pill and space+after
    anchorNode.setTextContent(beforeText);
    anchorNode.insertAfter(pillNode);
    if (spaceAndAfter) {
      pillNode.insertAfter($createTextNode(spaceAndAfter));
    }
  } else {
    // Replace entire node with pill, then add space+after
    anchorNode.replace(pillNode);
    if (spaceAndAfter) {
      pillNode.insertAfter($createTextNode(spaceAndAfter));
    }
  }

  // Set cursor after the pill (and space if added)
  pillNode.selectNext();
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
 * Attempts to resolve a tool reference
 * @param toolName The name of the tool to resolve (with or without @)
 * @returns The tool name if valid, null otherwise
 */
function resolveToolReference(toolName: string): string | null {
  // Ensure the tool name has @ prefix
  const normalizedToolName = toolName.startsWith("@") ? toolName : `@${toolName}`;

  if (AVAILABLE_TOOLS.includes(normalizedToolName)) {
    return normalizedToolName;
  }

  return null;
}

/**
 * Attempts to resolve a tag reference
 * @param tagName The name of the tag to resolve (with or without #)
 * @returns The tag name if valid, null otherwise
 */
function resolveTagReference(tagName: string): string | null {
  if (!app?.metadataCache) {
    return null;
  }

  try {
    // Ensure the tag name has # prefix
    const normalizedTagName = tagName.startsWith("#") ? tagName : `#${tagName}`;

    // Get all tags from the vault (frontmatter only)
    const allTags = new Set<string>();
    app.vault.getMarkdownFiles().forEach((file) => {
      const metadata = app.metadataCache.getFileCache(file);
      const frontmatterTags = metadata?.frontmatter?.tags;

      if (frontmatterTags) {
        if (Array.isArray(frontmatterTags)) {
          frontmatterTags.forEach((tag) => {
            if (typeof tag === "string") {
              const tagString = tag.startsWith("#") ? tag : `#${tag}`;
              allTags.add(tagString);
            }
          });
        } else if (typeof frontmatterTags === "string") {
          const tagString = frontmatterTags.startsWith("#")
            ? frontmatterTags
            : `#${frontmatterTags}`;
          allTags.add(tagString);
        }
      }
    });

    if (allTags.has(normalizedTagName)) {
      return normalizedTagName;
    }

    return null;
  } catch (error) {
    logInfo("Error resolving tag reference:", error);
    return null;
  }
}

/**
 * Attempts to resolve a folder reference to a TFolder
 * @param folderName The name of the folder to resolve
 * @returns TFolder if found, null otherwise
 */
function resolveFolderReference(folderName: string): TFolder | null {
  if (!app?.vault) {
    return null;
  }

  try {
    // Get all folders in the vault
    const allFolders = app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder);

    // First, try exact name match
    for (const folder of allFolders) {
      if (folder.name === folderName) {
        return folder;
      }
    }

    // Then, try path match for nested folders
    for (const folder of allFolders) {
      if (folder.path === folderName) {
        return folder;
      }
    }

    // Finally, try case-insensitive match
    const lowerFolderName = folderName.toLowerCase();
    for (const folder of allFolders) {
      if (
        folder.name.toLowerCase() === lowerFolderName ||
        folder.path.toLowerCase() === lowerFolderName
      ) {
        return folder;
      }
    }

    return null;
  } catch (error) {
    logInfo("Error resolving folder reference:", error);
    return null;
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
 * Parses text content to extract [[note name]], @tool, #tag patterns and optionally URLs, converting them to appropriate pills
 * @param text The text content to parse
 * @param options Options for what types of pills to process
 * @returns Array of parsed content segments with type information
 */
export function parseTextForPills(
  text: string,
  options: {
    includeNotes?: boolean;
    includeURLs?: boolean;
    includeTools?: boolean;
    includeTags?: boolean;
    includeFolders?: boolean;
  } = {}
): ParsedContent[] {
  const {
    includeNotes = true,
    includeURLs = false,
    includeTools = false,
    includeTags = false,
    includeFolders = false,
  } = options;
  const segments: ParsedContent[] = [];

  // Build regex pattern based on enabled options
  const patterns: string[] = [];
  if (includeNotes) patterns.push("(\\[\\[([^\\]]+)\\]\\])"); // Group 1,2: [[note name]]
  if (includeURLs) patterns.push("(https?:\\/\\/[^\\s\"'<>]+)"); // Group 3: URLs
  if (includeTools) patterns.push("(@[a-zA-Z][a-zA-Z0-9_]*)"); // Group 4: @tool
  if (includeTags) patterns.push("(#[a-zA-Z][a-zA-Z0-9_\\-]*)"); // Group 5: #tag
  if (includeFolders) patterns.push("(\\{([^}]+)\\})"); // Group 6,7: {folderName}

  if (patterns.length === 0) {
    // No patterns to match, return as plain text
    return [{ type: "text", content: text }];
  }

  const regex = new RegExp(patterns.join("|"), "g");
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

    if (match[1] && includeNotes) {
      // This is a note link [[note name]]
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
    } else if (match[3] && includeURLs) {
      // This is a URL
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
    } else if (match[4] && includeTools) {
      // This is a tool reference @tool
      const toolName = match[4];
      const resolvedTool = resolveToolReference(toolName);

      if (resolvedTool) {
        segments.push({
          type: "tool-pill",
          content: resolvedTool,
          toolName: resolvedTool,
        });
      } else {
        // Invalid tool reference - keep as plain text
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (match[5] && includeTags) {
      // This is a tag reference #tag
      const tagName = match[5];
      const resolvedTag = resolveTagReference(tagName);

      if (resolvedTag) {
        segments.push({
          type: "tag-pill",
          content: resolvedTag,
          tagName: resolvedTag,
        });
      } else {
        // Invalid tag reference - keep as plain text
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (match[6] && includeFolders) {
      // This is a folder reference {folderName}
      const folderName = match[7].trim();
      const resolvedFolder = resolveFolderReference(folderName);

      if (resolvedFolder) {
        segments.push({
          type: "folder-pill",
          content: resolvedFolder.path,
          folder: resolvedFolder,
        });
      } else {
        // Invalid folder reference - keep as plain text
        segments.push({
          type: "text",
          content: match[0],
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
    } else if (segment.type === "tool-pill" && segment.toolName) {
      nodes.push($createToolPillNode(segment.toolName));
    } else if (segment.type === "tag-pill" && segment.tagName) {
      nodes.push($createTagPillNode(segment.tagName));
    } else if (segment.type === "folder-pill" && segment.folder) {
      nodes.push($createFolderPillNode(segment.folder.name, segment.folder.path));
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
  const segments = parseTextForPills(text, {
    includeNotes: true,
    includeURLs: enableURLPills,
  });

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
  const segments = parseTextForPills(newText, {
    includeNotes: true,
    includeURLs: enableURLPills,
  });

  if (segments.length === 1 && segments[0].type === "text") {
    // Simple case: just text, no pills needed
    const { beforeText, afterText } = splitTextAtRange(textContent, startOffset, endOffset);
    const finalText = beforeText + segments[0].content + afterText;
    textNode.setTextContent(finalText);

    // Set cursor after inserted text
    const newOffset = beforeText.length + segments[0].content.length;
    textNode.select(newOffset, newOffset);
  } else {
    // Complex case: we have pills to insert
    const { beforeText, afterText } = splitTextAtRange(textContent, startOffset, endOffset);

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
    $replaceTextNodeWithNodes(textNode, nodes);
  }
}

/**
 * Generic function to replace text from a trigger character to current cursor position with a pill
 * This can be used by any typeahead plugin that needs to replace triggered text with pills
 * @param triggerChar The character that triggered the replacement (e.g., '@', '/', '[[')
 * @param pillData The pill data to insert
 * @param addSpaceAfter Whether to add a space after the pill (default: true)
 */
export function $replaceTriggeredTextWithPill(
  triggerChar: string,
  pillData: PillData,
  addSpaceAfter: boolean = true
): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();

  if (!(anchorNode instanceof TextNode)) return;

  const textContent = anchorNode.getTextContent();
  const cursorOffset = anchor.offset;

  // Find the trigger position
  let triggerIndex = -1;

  if (triggerChar === "[[") {
    // Special case for double-bracket triggers
    triggerIndex = textContent.lastIndexOf("[[", cursorOffset);
  } else {
    // Single character triggers
    triggerIndex = textContent.lastIndexOf(triggerChar, cursorOffset);
  }

  if (triggerIndex === -1) return;

  const { beforeText, afterText } = splitTextAtRange(textContent, triggerIndex, cursorOffset);

  // Create the pill node
  const pillNode = $createPillNode(pillData);

  // Insert pill with optional space
  $insertPillWithOptionalSpace(anchorNode, beforeText, pillNode, afterText, addSpaceAfter);
}
