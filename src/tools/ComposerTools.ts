import { App, TFile } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/constants";
import { diffTrimmedLines } from "diff";
import { ApplyViewResult } from "@/types";
import * as z from "zod";
import { createLangChainTool } from "./createLangChainTool";
import { ensureFolderExists, sanitizeFilePath } from "@/utils";
import { getSettings } from "@/settings/model";
import { logWarn } from "@/logger";

async function getFile(app: App, file_path: string): Promise<TFile> {
  let file = app.vault.getAbstractFileByPath(file_path);
  if (file && file instanceof TFile) {
    return file;
  }

  if (file && !(file instanceof TFile)) {
    throw new Error(`Path "${file_path}" exists but is not a file`);
  }

  try {
    const folder = file_path.includes("/") ? file_path.split("/").slice(0, -1).join("/") : "";
    if (folder) {
      await ensureFolderExists(app.vault, folder);
    }

    file = app.vault.getAbstractFileByPath(file_path);
    if (file && file instanceof TFile) {
      return file;
    }

    file = await app.vault.create(file_path, "");
    if (!(file instanceof TFile)) {
      throw new Error(`Failed to create file: unexpected type returned for "${file_path}"`);
    }

    return file;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get or create file "${file_path}": ${message}`);
  }
}

async function show_preview(
  app: App,
  file_path: string,
  content: string,
  simple = false
): Promise<ApplyViewResult> {
  const file = await getFile(app, file_path);
  const activeFile = app.workspace.getActiveFile();

  if (file && (!activeFile || activeFile.path !== file_path)) {
    await app.workspace.getLeaf().openFile(file);
  }

  let originalContent = "";
  if (file) {
    originalContent = await app.vault.read(file);
  }
  const changes = diffTrimmedLines(originalContent, content, {
    newlineIsToken: true,
  });
  return new Promise((resolve) => {
    const leaf = app.workspace.getLeaf(true);
    void leaf.setViewState({
      type: APPLY_VIEW_TYPE,
      active: true,
      state: {
        changes: changes,
        path: file_path,
        simple: simple,
        resultCallback: (result: ApplyViewResult) => {
          resolve(result);
        },
      },
    });
  });
}

const writeFileSchema = z.object({
  path: z.string().describe(`(Required) The path to the file to write to. 
          The path must end with explicit file extension, such as .md or .canvas .
          Prefer to create new files in existing folders or root folder unless the user's request specifies otherwise.
          The path must be relative to the root of the vault.`),
  content: z.union([z.string(), z.object({}).loose()])
    .describe(`(Required) The content to write to the file. Can be either a string or an object.
          ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. 
          You MUST include ALL parts of the file, even if they haven't been modified.

          # For string content
          * Use when writing text files like .md, .txt, etc.
          
          # For object content  
          * Use when writing structured data files like .json, .canvas, etc.
          * The object will be automatically converted to JSON string format
          
          # Canvas JSON Format (JSON Canvas spec 1.0)
          Required node fields: id, type, x, y, width, height
          Node types: "text" (needs text), "file" (needs file), "link" (needs url), "group" (optional label)
          Optional node fields: color (hex #FF0000 or preset "1"-"6"), subpath (file nodes, starts with #)
          Required edge fields: id, fromNode, toNode
          Optional edge fields: fromSide/toSide ("top"/"right"/"bottom"/"left"), fromEnd/toEnd ("none"/"arrow"), color, label
          All IDs must be unique. Edge nodes must reference existing node IDs.
          
          Example:
          {
            "nodes": [
              {"id": "1", "type": "text", "text": "Hello", "x": 0, "y": 0, "width": 200, "height": 50},
              {"id": "2", "type": "file", "file": "note.md", "subpath": "#heading", "x": 250, "y": 0, "width": 200, "height": 100, "color": "2"},
              {"id": "3", "type": "group", "label": "Group", "x": 0, "y": 100, "width": 300, "height": 150}
            ],
            "edges": [
              {"id": "e1-2", "fromNode": "1", "toNode": "2", "fromSide": "right", "toSide": "left", "color": "3", "label": "links to"}
            ]
          }`),
  confirmation: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe(
      `(Optional) Hint for confirmation preference. Note: preview is always shown unless the user has enabled auto-accept in settings.`
    ),
});

const createWriteFileTool = (app: App) =>
  createLangChainTool({
    name: "writeFile",
    description: `Request to write content to a file at the specified path and show the changes in a Change Preview UI.

      # Steps to find the the target path
      1. Extract the target file information from user message and find out the file path from the context.
      2. If target file is not specified, use the active note as the target file.
      3. If still failed to find the target file or the file path, ask the user to specify the target file.
      `,
    schema: writeFileSchema,
    func: async ({ path, content, confirmation = true }) => {
      const sanitizedPath = sanitizeFilePath(path);
      if (sanitizedPath !== path) {
        logWarn(
          `Filename too long, truncated for filesystem compatibility: "${path}" → "${sanitizedPath}"`
        );
        path = sanitizedPath;
      }

      const contentString =
        typeof content === "string" ? content : JSON.stringify(content, null, 2);

      const settings = getSettings();
      const shouldBypassConfirmation = settings.autoAcceptEdits;

      if (shouldBypassConfirmation) {
        try {
          const file = await getFile(app, path);
          await app.vault.modify(file, contentString);
          return {
            result: "accepted" as ApplyViewResult,
            message:
              "File changes applied without preview. Do not retry or attempt alternative approaches to modify this file in response to the current user request.",
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            result: "failed" as ApplyViewResult,
            message: `Error writing to file without preview: ${message}`,
          };
        }
      }

      const result = await show_preview(app, path, contentString);
      return {
        result: result,
        message: `File change result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`,
      };
    },
  });

const editFileSchema = z.object({
  path: z
    .string()
    .describe(
      `(Required) The path of the file to modify (relative to the root of the vault and include the file extension).`
    ),
  oldText: z.string().describe(
    `(Required) The exact text to find and replace. Must match the file content exactly, including whitespace and indentation.
Fuzzy matching handles minor differences like trailing spaces or smart quotes, but the overall structure must be correct.
To make the match unique, include enough surrounding context lines (not just the changed line).`
  ),
  newText: z
    .string()
    .describe(
      `(Required) The new text to replace the old text with. Can be empty string to delete the old text.`
    ),
});

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function countOccurrences(content: string, searchText: string): number {
  if (!searchText) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(searchText, pos)) !== -1) {
    count++;
    pos += 1;
  }
  return count;
}

function stripBOM(content: string): { content: string; hasBOM: boolean } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { content: content.slice(1), hasBOM: true };
  }
  return { content, hasBOM: false };
}

interface TextSearchResult {
  found: boolean;
  occurrences: number;
  workingContent: string;
  workingSearch: string;
  workingReplace: string;
  usedFuzzyMatch: boolean;
}

function findTextForReplacement(
  normalizedContent: string,
  normalizedOldText: string,
  normalizedNewText: string
): TextSearchResult {
  const exactCount = countOccurrences(normalizedContent, normalizedOldText);
  if (exactCount > 0) {
    return {
      found: true,
      occurrences: exactCount,
      workingContent: normalizedContent,
      workingSearch: normalizedOldText,
      workingReplace: normalizedNewText,
      usedFuzzyMatch: false,
    };
  }

  const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
  const fuzzySearch = normalizeForFuzzyMatch(normalizedOldText);

  const fuzzyCount = countOccurrences(fuzzyContent, fuzzySearch);
  if (fuzzyCount > 0) {
    return {
      found: true,
      occurrences: fuzzyCount,
      workingContent: fuzzyContent,
      workingSearch: fuzzySearch,
      workingReplace: normalizedNewText,
      usedFuzzyMatch: true,
    };
  }

  if (normalizedOldText.endsWith("\n")) {
    const trimmedOldText = normalizedOldText.slice(0, -1);
    const trimmedNewText = normalizedNewText.endsWith("\n")
      ? normalizedNewText.slice(0, -1)
      : normalizedNewText;

    const trimmedExactCount = countOccurrences(normalizedContent, trimmedOldText);
    if (trimmedExactCount > 0) {
      return {
        found: true,
        occurrences: trimmedExactCount,
        workingContent: normalizedContent,
        workingSearch: trimmedOldText,
        workingReplace: trimmedNewText,
        usedFuzzyMatch: false,
      };
    }

    const fuzzyTrimmedSearch = normalizeForFuzzyMatch(trimmedOldText);
    const fuzzyTrimmedCount = countOccurrences(fuzzyContent, fuzzyTrimmedSearch);
    if (fuzzyTrimmedCount > 0) {
      return {
        found: true,
        occurrences: fuzzyTrimmedCount,
        workingContent: fuzzyContent,
        workingSearch: fuzzyTrimmedSearch,
        workingReplace: trimmedNewText,
        usedFuzzyMatch: true,
      };
    }
  }

  return {
    found: false,
    occurrences: 0,
    workingContent: fuzzyContent,
    workingSearch: fuzzySearch,
    workingReplace: normalizedNewText,
    usedFuzzyMatch: true,
  };
}

function mapFuzzyIndexToNormal(
  normalLines: string[],
  fuzzyLines: string[],
  fuzzyIndex: number
): number {
  let remaining = fuzzyIndex;
  let normalPos = 0;

  for (let i = 0; i < fuzzyLines.length; i++) {
    const fuzzyLineLen = fuzzyLines[i].length;
    const normalLine = normalLines[i] ?? "";
    const normalLineLen = normalLine.length;
    if (remaining <= fuzzyLineLen) {
      if (remaining === fuzzyLineLen) {
        return normalPos + normalLineLen;
      }
      let fi = 0;
      let ni = 0;
      while (ni < normalLine.length && fi < remaining) {
        const expandedLen = normalLine[ni].normalize("NFKC").length;
        if (fi + expandedLen > remaining) break;
        fi += expandedLen;
        ni++;
      }
      return normalPos + ni;
    }
    remaining -= fuzzyLineLen + 1;
    normalPos += normalLineLen + 1;
  }

  return normalPos;
}

export type ApplyEditResult =
  | { ok: true; content: string }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "AMBIGUOUS"; occurrences: number };

export function applyEditToContent(
  content: string,
  oldText: string,
  newText: string
): ApplyEditResult {
  const { content: contentNoBOM, hasBOM } = stripBOM(content);

  const crlfCount = (contentNoBOM.match(/\r\n/g) || []).length;
  const lfCount = (contentNoBOM.match(/(?<!\r)\n/g) || []).length;
  const usesCrlf = crlfCount > lfCount;

  const normalizedContent = normalizeLineEndings(contentNoBOM);
  const normalizedOldText = normalizeLineEndings(oldText);
  const normalizedNewText = normalizeLineEndings(newText);

  const searchResult = findTextForReplacement(
    normalizedContent,
    normalizedOldText,
    normalizedNewText
  );

  if (!searchResult.found) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (searchResult.occurrences > 1) {
    return { ok: false, reason: "AMBIGUOUS", occurrences: searchResult.occurrences };
  }

  let matchStart: number;
  let matchEnd: number;

  if (searchResult.usedFuzzyMatch) {
    const normalLines = normalizedContent.split("\n");
    const fuzzyLines = searchResult.workingContent.split("\n");
    const fuzzyMatchIndex = searchResult.workingContent.indexOf(searchResult.workingSearch);
    matchStart = mapFuzzyIndexToNormal(normalLines, fuzzyLines, fuzzyMatchIndex);
    matchEnd = mapFuzzyIndexToNormal(
      normalLines,
      fuzzyLines,
      fuzzyMatchIndex + searchResult.workingSearch.length
    );
    if (matchStart >= matchEnd) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    const roundTrip = normalizeForFuzzyMatch(normalizedContent.substring(matchStart, matchEnd));
    if (roundTrip !== searchResult.workingSearch) {
      return { ok: false, reason: "NOT_FOUND" };
    }
  } else {
    matchStart = normalizedContent.indexOf(searchResult.workingSearch);
    matchEnd = matchStart + searchResult.workingSearch.length;
  }

  let modifiedContent =
    normalizedContent.substring(0, matchStart) +
    searchResult.workingReplace +
    normalizedContent.substring(matchEnd);

  if (usesCrlf) {
    modifiedContent = modifiedContent.replace(/\n/g, "\r\n");
  }
  if (hasBOM) {
    modifiedContent = "\uFEFF" + modifiedContent;
  }

  return { ok: true, content: modifiedContent };
}

const createEditFileTool = (app: App) =>
  createLangChainTool({
    name: "editFile",
    description: `Request to make a targeted change to an existing file by specifying the exact text to find and its replacement. Use this tool for precise, surgical edits to specific parts of a file.`,
    schema: editFileSchema,
    func: async ({
      path,
      oldText,
      newText,
    }: {
      path: string;
      oldText: string;
      newText: string;
    }) => {
      const sanitizedPath = sanitizeFilePath(path);
      const file = app.vault.getAbstractFileByPath(sanitizedPath);

      if (!file || !(file instanceof TFile)) {
        return {
          result: "failed" as ApplyViewResult,
          message: `File not found at path: ${sanitizedPath}. Please check the file path and try again.`,
        };
      }

      try {
        const rawContent = await app.vault.read(file);
        const editResult = applyEditToContent(rawContent, oldText, newText);

        if (!editResult.ok) {
          if (editResult.reason === "NOT_FOUND") {
            return {
              result: "failed" as ApplyViewResult,
              message: `Could not find the specified text in ${sanitizedPath}. The oldText must match the file content — try including more surrounding context lines to locate the right spot.`,
            };
          }
          return {
            result: "failed" as ApplyViewResult,
            message: `Found ${editResult.occurrences} occurrences of the search text in ${sanitizedPath}. The text must be unique — add more surrounding context to make it unambiguous.`,
          };
        }

        const modifiedContent = editResult.content;

        if (rawContent === modifiedContent) {
          return {
            result: "accepted" as ApplyViewResult,
            message: `No changes made to ${sanitizedPath}. The replacement produced identical content. Use writeFile if the file needs a broader rewrite.`,
          };
        }

        const settings = getSettings();
        if (settings.autoAcceptEdits) {
          await app.vault.modify(file, modifiedContent);
          return {
            result: "accepted" as ApplyViewResult,
            message:
              "File changes applied without preview. Do not retry or attempt alternative approaches to modify this file in response to the current user request.",
          };
        }

        const result = await show_preview(app, sanitizedPath, modifiedContent, true);
        return {
          result: result,
          message: `File change result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`,
        };
      } catch (error) {
        return {
          result: "failed" as ApplyViewResult,
          message: `Error modifying ${sanitizedPath}: ${error}. Please check the file path and try again.`,
        };
      }
    },
  });

export { createWriteFileTool, createEditFileTool, normalizeLineEndings, normalizeForFuzzyMatch };
