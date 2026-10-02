import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  LexicalNode,
  TextNode,
  createCommand,
  LexicalCommand,
} from "lexical";
import { TFile, TFolder, App } from "obsidian";
import type { WebTabContext } from "@/types/message";
import { $createNotePillNode } from "@/components/chat-components/pills/NotePillNode";
import { $createActiveNotePillNode } from "@/components/chat-components/pills/ActiveNotePillNode";
import { $createURLPillNode } from "@/components/chat-components/pills/URLPillNode";
import { $createToolPillNode } from "@/components/chat-components/pills/ToolPillNode";
import { $createFolderPillNode } from "@/components/chat-components/pills/FolderPillNode";
import { $createWebTabPillNode } from "@/components/chat-components/pills/WebTabPillNode";
import { $createActiveWebTabPillNode } from "@/components/chat-components/pills/ActiveWebTabPillNode";
import { $createAgentPillNode } from "@/components/chat-components/pills/AgentPillNode";
import { logInfo } from "@/logger";
import { AVAILABLE_TOOLS } from "@/components/chat-components/constants/tools";

export type PillType =
  | "notes"
  | "tools"
  | "folders"
  | "active-note"
  | "webTabs"
  | "activeWebTab"
  | "agents";

export type ParsedContentType =
  | "text"
  | "note-pill"
  | "active-note-pill"
  | "url-pill"
  | "tool-pill"
  | "folder-pill";

export type PatternType = "notes" | "urls" | "tools" | "customTemplates";

export type PillDataValue = TFile | TFolder | string | WebTabContext;

export interface PillData {
  type: PillType;
  title?: string;
  data?: PillDataValue;
}

function $createPillNode(pillData: PillData) {
  const { type, title, data } = pillData;

  switch (type) {
    case "active-note":
      return $createActiveNotePillNode();
    case "notes":
      if (data instanceof TFile && title) {
        return $createNotePillNode(title, data.path);
      }
      break;
    case "tools":
      if (typeof data === "string") {
        return $createToolPillNode(data);
      }
      break;
    case "folders":
      if (data instanceof TFolder) {
        return $createFolderPillNode(data.path);
      }
      break;
    case "webTabs":
      if (data && typeof data === "object" && "url" in data) {
        return $createWebTabPillNode(data.url, data.title, data.faviconUrl);
      }
      break;
    case "activeWebTab":
      return $createActiveWebTabPillNode();
    case "agents":
      if (typeof data === "string") {
        return $createAgentPillNode(data, title ?? data);
      }
      break;
  }

  throw new Error(`Invalid pill data: ${JSON.stringify(pillData)}`);
}

export interface ParsedContent {
  type: ParsedContentType;
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
}

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

function $insertPillWithOptionalSpace(
  anchorNode: TextNode,
  beforeText: string,
  pillNode: LexicalNode,
  afterText: string,
  addSpace: boolean
): void {
  const spaceAndAfter = addSpace ? (afterText ? " " + afterText : " ") : afterText;

  if (beforeText) {
    anchorNode.setTextContent(beforeText);
    anchorNode.insertAfter(pillNode);
    if (spaceAndAfter) {
      pillNode.insertAfter($createTextNode(spaceAndAfter));
    }
  } else {
    anchorNode.replace(pillNode);
    if (spaceAndAfter) {
      pillNode.insertAfter($createTextNode(spaceAndAfter));
    }
  }

  pillNode.selectNext();
}

export const INSERT_TEXT_WITH_PILLS_COMMAND: LexicalCommand<{
  text: string;
  options?: InsertTextOptions;
}> = createCommand("INSERT_TEXT_WITH_PILLS_COMMAND");

function isValidURL(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveToolReference(toolName: string): string | null {
  const normalizedToolName = toolName.startsWith("@") ? toolName : `@${toolName}`;

  if (AVAILABLE_TOOLS.includes(normalizedToolName)) {
    return normalizedToolName;
  }

  return null;
}

function resolveFolderReference(app: App, folderName: string): TFolder | null {
  if (!app?.vault) {
    return null;
  }

  try {
    const allFolders = app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder);

    for (const folder of allFolders) {
      if (folder.name === folderName) {
        return folder;
      }
    }

    for (const folder of allFolders) {
      if (folder.path === folderName) {
        return folder;
      }
    }

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

function resolveNoteReference(app: App, noteName: string): TFile | null {
  if (!app?.vault || !app?.metadataCache) {
    return null;
  }

  try {
    const file = app.metadataCache.getFirstLinkpathDest(noteName, "");

    if (file && file instanceof TFile) {
      return file;
    }

    if (!noteName.endsWith(".md")) {
      const fileWithExt = app.metadataCache.getFirstLinkpathDest(noteName + ".md", "");
      if (fileWithExt && fileWithExt instanceof TFile) {
        return fileWithExt;
      }
    }

    if (!noteName.endsWith(".pdf")) {
      const pdfFile = app.metadataCache.getFirstLinkpathDest(noteName + ".pdf", "");
      if (pdfFile && pdfFile instanceof TFile) {
        return pdfFile;
      }
    }

    const markdownFiles = app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      if (file.basename === noteName || file.name === noteName) {
        return file;
      }
    }

    const allFiles = app.vault.getFiles();
    const pdfFiles = allFiles.filter(
      (file): file is TFile => file instanceof TFile && file.extension === "pdf"
    );
    for (const file of pdfFiles) {
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

interface PatternInfo {
  type: PatternType;
  groupCount: number;
  startIndex: number;
}

export function parseTextForPills(
  app: App,
  text: string,
  options: {
    includeNotes?: boolean;
    includeURLs?: boolean;
    includeTools?: boolean;
    includeCustomTemplates?: boolean;
  } = {}
): ParsedContent[] {
  const {
    includeNotes = true,
    includeURLs = false,
    includeTools = false,
    includeCustomTemplates = false,
  } = options;
  const segments: ParsedContent[] = [];

  const patterns: string[] = [];
  const patternInfo: PatternInfo[] = [];
  let currentGroupIndex = 1;

  if (includeNotes) {
    patterns.push("(\\[\\[([^\\]]+)\\]\\])");
    patternInfo.push({ type: "notes", groupCount: 2, startIndex: currentGroupIndex });
    currentGroupIndex += 2;
  }
  if (includeURLs) {
    patterns.push("(https?:\\/\\/[^\\s\"'<>]+)");
    patternInfo.push({ type: "urls", groupCount: 1, startIndex: currentGroupIndex });
    currentGroupIndex += 1;
  }
  if (includeTools) {
    patterns.push("(@[a-zA-Z][a-zA-Z0-9_]*)");
    patternInfo.push({ type: "tools", groupCount: 1, startIndex: currentGroupIndex });
    currentGroupIndex += 1;
  }
  if (includeCustomTemplates) {
    patterns.push("(\\{([^}]+)\\})");
    patternInfo.push({ type: "customTemplates", groupCount: 2, startIndex: currentGroupIndex });
    currentGroupIndex += 2;
  }

  if (patterns.length === 0) {
    return [{ type: "text", content: text }];
  }

  const regex = new RegExp(patterns.join("|"), "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        segments.push({
          type: "text",
          content: textContent,
        });
      }
    }

    let matchedPattern: PatternInfo | null = null;
    for (const pattern of patternInfo) {
      if (match[pattern.startIndex]) {
        matchedPattern = pattern;
        break;
      }
    }

    if (!matchedPattern) {
      segments.push({
        type: "text",
        content: match[0],
      });
    } else if (matchedPattern.type === "notes") {
      const noteName = match[matchedPattern.startIndex + 1].trim();
      const file = resolveNoteReference(app, noteName);

      if (file && file instanceof TFile) {
        const activeNote = app.workspace.getActiveFile();
        const isActive = activeNote?.path === file.path;

        segments.push({
          type: "note-pill",
          content: file.basename,
          file: file,
          isActive: isActive,
        });
      } else {
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (matchedPattern.type === "urls") {
      const url = match[matchedPattern.startIndex].replace(/,+$/, "");
      if (isValidURL(url)) {
        segments.push({
          type: "url-pill",
          content: url,
          url: url,
        });
      } else {
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (matchedPattern.type === "tools") {
      const toolName = match[matchedPattern.startIndex];
      const resolvedTool = resolveToolReference(toolName);

      if (resolvedTool) {
        segments.push({
          type: "tool-pill",
          content: resolvedTool,
          toolName: resolvedTool,
        });
      } else {
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (matchedPattern.type === "customTemplates") {
      const templateContent = match[matchedPattern.startIndex + 1].trim();

      if (templateContent === "activeNote") {
        segments.push({
          type: "active-note-pill",
          content: "activeNote",
        });
      } else {
        const resolvedFolder = resolveFolderReference(app, templateContent);

        if (resolvedFolder) {
          segments.push({
            type: "folder-pill",
            content: resolvedFolder.path,
            folder: resolvedFolder,
          });
        } else {
          segments.push({
            type: "text",
            content: match[0],
          });
        }
      }
    }

    lastIndex = regex.lastIndex;
  }

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

export function createNodesFromSegments(segments: ParsedContent[]): LexicalNode[] {
  const nodes: LexicalNode[] = [];

  for (const segment of segments) {
    if (segment.type === "text" && segment.content) {
      nodes.push($createTextNode(segment.content));
    } else if (segment.type === "active-note-pill") {
      nodes.push($createActiveNotePillNode());
    } else if (segment.type === "note-pill" && segment.file) {
      nodes.push($createNotePillNode(segment.content, segment.file.path));
    } else if (segment.type === "url-pill" && segment.url) {
      nodes.push($createURLPillNode(segment.url));
    } else if (segment.type === "tool-pill" && segment.toolName) {
      nodes.push($createToolPillNode(segment.toolName));
    } else if (segment.type === "folder-pill" && segment.folder) {
      nodes.push($createFolderPillNode(segment.folder.path));
    }
  }

  return nodes;
}

export function $insertTextWithPills(
  app: App,
  text: string,
  options: InsertTextOptions = {}
): void {
  const { enableURLPills = false } = options;

  if (!text) return;

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    logInfo("No range selection available for text insertion");
    return;
  }

  const segments = parseTextForPills(app, text, {
    includeNotes: true,
    includeURLs: enableURLPills,
  });

  const nodes = createNodesFromSegments(segments);

  if (nodes.length > 0) {
    selection.insertNodes(nodes);
  }
}

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

  let triggerIndex = -1;

  if (triggerChar === "[[") {
    triggerIndex = textContent.lastIndexOf("[[", cursorOffset);
  } else {
    triggerIndex = textContent.lastIndexOf(triggerChar, cursorOffset);
  }

  if (triggerIndex === -1) return;

  const { beforeText, afterText } = splitTextAtRange(textContent, triggerIndex, cursorOffset);

  const pillNode = $createPillNode(pillData);

  $insertPillWithOptionalSpace(anchorNode, beforeText, pillNode, afterText, addSpaceAfter);
}
