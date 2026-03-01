import { TFile } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { diffTrimmedLines } from "diff";
import { ApplyViewResult } from "@/types";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";
import { ensureFolderExists, sanitizeFilePath } from "@/utils";
import { getSettings } from "@/settings/model";
import { logWarn } from "@/logger";

async function getFile(file_path: string): Promise<TFile> {
  let file = app.vault.getAbstractFileByPath(file_path);
  if (file && file instanceof TFile) {
    return file;
  }

  // Handle case where path exists but is not a file (e.g., it's a folder)
  if (file && !(file instanceof TFile)) {
    throw new Error(`Path "${file_path}" exists but is not a file`);
  }

  try {
    const folder = file_path.includes("/") ? file_path.split("/").slice(0, -1).join("/") : "";
    if (folder) {
      await ensureFolderExists(folder);
    }

    // Double-check if file was created by another process
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
    throw new Error(`Failed to get or create file "${file_path}": ${error.message}`);
  }
}

/**
 * Show the ApplyView preview UI for file changes and return the user decision.
 * @param file_path - Vault-relative path to the file
 * @param content - Target content to compare against current file content
 */
async function show_preview(file_path: string, content: string): Promise<ApplyViewResult> {
  const file = await getFile(file_path);
  const activeFile = app.workspace.getActiveFile();

  if (file && (!activeFile || activeFile.path !== file_path)) {
    // If target file is not the active file, open the target file in the current leaf
    await app.workspace.getLeaf().openFile(file as TFile);
  }

  let originalContent = "";
  if (file) {
    originalContent = await app.vault.read(file as TFile);
  }
  const changes = diffTrimmedLines(originalContent, content, {
    newlineIsToken: true,
  });
  // Return a promise that resolves when the user makes a decision
  return new Promise((resolve) => {
    // Open the Apply View in a new leaf with the processed content and the callback
    const leaf = app.workspace.getLeaf(true);
    leaf.setViewState({
      type: APPLY_VIEW_TYPE,
      active: true,
      state: {
        changes: changes,
        path: file_path,
        resultCallback: (result: ApplyViewResult) => {
          resolve(result);
        },
      },
    });
  });
}

// Define Zod schema for writeToFile
const writeToFileSchema = z.object({
  path: z.string().describe(`(Required) The path to the file to write to. 
          The path must end with explicit file extension, such as .md or .canvas .
          Prefer to create new files in existing folders or root folder unless the user's request specifies otherwise.
          The path must be relative to the root of the vault.`),
  content: z.union([z.string(), z.object({}).passthrough()])
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
    .preprocess((val) => {
      if (typeof val === "string") {
        const lc = val.trim().toLowerCase();
        if (lc === "true") return true;
        if (lc === "false") return false;
      }
      return val;
    }, z.boolean())
    .optional()
    .default(true)
    .describe(
      `(Optional) Whether to ask for change confirmation with preview UI before writing changes. Default: true. Set to false to skip preview and apply changes immediately.`
    ),
});

const writeToFileTool = createLangChainTool({
  name: "writeToFile",
  description: `Request to write content to a file at the specified path and show the changes in a Change Preview UI.

      # Steps to find the the target path
      1. Extract the target file information from user message and find out the file path from the context.
      2. If target file is not specified, use the active note as the target file.
      3. If still failed to find the target file or the file path, ask the user to specify the target file.
      `,
  schema: writeToFileSchema,
  func: async ({ path, content, confirmation = true }) => {
    // Sanitize path to prevent ENAMETOOLONG errors on filesystems with 255-byte limits.
    // Must happen here (not just in getFile) so show_preview also receives the sanitized path,
    // since ApplyView uses state.path with its own getFile that doesn't sanitize.
    const sanitizedPath = sanitizeFilePath(path);
    if (sanitizedPath !== path) {
      logWarn(
        `Filename too long, truncated for filesystem compatibility: "${path}" → "${sanitizedPath}"`
      );
      path = sanitizedPath;
    }

    // Convert object content to JSON string if needed
    const contentString = typeof content === "string" ? content : JSON.stringify(content, null, 2);

    // Check if auto-accept edits is enabled in settings
    const settings = getSettings();
    const shouldBypassConfirmation = settings.autoAcceptEdits || confirmation === false;

    if (shouldBypassConfirmation) {
      try {
        const file = await getFile(path);
        await app.vault.modify(file, contentString);
        
        // Post-write verification
        await new Promise(resolve => setTimeout(resolve, 200));
        const verifyContent = await app.vault.read(file);
        
        if (verifyContent.trim() === contentString.trim()) {
          return {
            result: "accepted" as ApplyViewResult,
            message:
              "WRITE_VERIFIED: File successfully updated. Do not read the file again to verify — this tool has already verified the write. Do not retry or attempt alternative approaches to modify this file in response to the current user request.",
          };
        } else {
          return {
            result: "failed" as ApplyViewResult,
            message:
              "WRITE_FAILED: Content mismatch detected after write. The file content on disk does not match the requested update. Inform the user of the failure.",
          };
        }
      } catch (error: any) {
        return {
          result: "failed" as ApplyViewResult,
          message: `Error writing to file: ${error?.message || error}`,
        };
      }
    }

    const result = await show_preview(path, contentString);
    // Simple JSON wrapper for consistent parsing
    return {
      result: result,
      message: `File change result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`,
    };
  },
});

const replaceInFileSchema = z.object({
  path: z
    .string()
    .describe(
      `(Required) The path of the file to modify (relative to the root of the vault and include the file extension).`
    ),
  diff: z.string()
    .describe(`(Required) One or more SEARCH/REPLACE blocks. Each block MUST follow this exact format with these exact markers:

------- SEARCH
[exact content to find, including all whitespace and indentation]
=======
[new content to replace with]
+++++++ REPLACE

WHEN TO USE THIS TOOL vs writeToFile:
- Use replaceInFile for: small edits, fixing typos, updating specific sections, targeted changes
- Use writeToFile for: creating new files, major rewrites, when you can't identify specific text to replace

CRITICAL RULES:
1. SEARCH content must match EXACTLY - every character, space, and line break
2. Use the exact markers: "------- SEARCH", "=======", "+++++++ REPLACE"
3. For multiple changes, include multiple SEARCH/REPLACE blocks in order
4. Keep blocks concise - include only the lines being changed plus minimal context

COMMON MISTAKES TO AVOID:
- Wrong: Using different markers like "---- SEARCH" or "SEARCH -------"
- Wrong: Including too many unchanged lines
- Wrong: Not matching whitespace/indentation exactly`),
});

/**
 * Normalizes line endings to LF (\n) for consistent string matching.
 * This helps avoid issues with mixed line endings (CRLF vs LF).
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Performs line ending aware text replacement.
 * Normalizes line endings for matching but preserves the original line ending style.
 */
function replaceWithLineEndingAwareness(
  content: string,
  searchText: string,
  replaceText: string
): string {
  // Detect the predominant line ending style in the original content
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  const usesCrlf = crlfCount > lfCount;

  // Normalize for matching
  const normalizedContent = normalizeLineEndings(content);
  const normalizedSearchText = normalizeLineEndings(searchText);
  const normalizedReplaceText = normalizeLineEndings(replaceText);

  // Perform replacement on normalized content
  const resultNormalized = normalizedContent.replaceAll(
    normalizedSearchText,
    normalizedReplaceText
  );

  // Convert back to original line ending style if CRLF was predominant
  if (usesCrlf) {
    return resultNormalized.replace(/\n/g, "\r\n");
  }

  return resultNormalized;
}

const replaceInFileTool = createLangChainTool({
  name: "replaceInFile",
  description: `Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a LARGE file.`,
  schema: replaceInFileSchema,
  func: async ({ path, diff }: { path: string; diff: string }) => {
    const file = app.vault.getAbstractFileByPath(path);

    if (!file || !(file instanceof TFile)) {
      return `File not found at path: ${path}. Please check the file path and try again.`;
    }

    try {
      const originalContent = await app.vault.read(file);
      let modifiedContent = originalContent;

      // Reject this tool if the original content is small
      const MIN_FILE_SIZE_FOR_REPLACE = 3000;
      if (originalContent.length < MIN_FILE_SIZE_FOR_REPLACE) {
        return `File is too small to use this tool. Please use writeToFile instead.`;
      }

      // Parse SEARCH/REPLACE blocks from diff
      const searchReplaceBlocks = parseSearchReplaceBlocks(diff);

      if (searchReplaceBlocks.length === 0) {
        return `No valid SEARCH/REPLACE blocks found in diff. Please use the correct format with ------- SEARCH, =======, and +++++++ REPLACE markers. \n diff: ${diff}`;
      }

      let changesApplied = 0;

      // Apply each SEARCH/REPLACE block in order
      for (const block of searchReplaceBlocks) {
        let { searchText, replaceText } = block;

        // Check if the search text exists in the current content (with line ending normalization)
        const normalizedContent = normalizeLineEndings(modifiedContent);
        const normalizedSearchText = normalizeLineEndings(searchText);

        if (!normalizedContent.includes(normalizedSearchText)) {
          // Handle corner case where the search text is at the end of the file
          if (normalizedContent.includes(normalizedSearchText.trimEnd())) {
            searchText = searchText.trimEnd();
            replaceText = replaceText.trimEnd();
          } else {
            return `Search text not found in file ${path} : "${searchText}".`;
          }
        }

        // Replace all occurrences using line ending aware replacement
        const beforeReplace = modifiedContent;
        modifiedContent = replaceWithLineEndingAwareness(modifiedContent, searchText, replaceText);

        // Check if any replacements were made
        if (modifiedContent !== beforeReplace) {
          changesApplied++;
        }
      }

      if (originalContent === modifiedContent) {
        return `No changes made to ${path}. The search text was not found or replacement resulted in identical content. Call writeToFile instead`;
      }

      // Check if auto-accept edits is enabled in settings
      const settings = getSettings();
      if (settings.autoAcceptEdits) {
        // Bypass preview and apply changes directly
        try {
          await app.vault.modify(file, modifiedContent);
          
          // Post-write verification (EXACT comparison - no trim)
          await new Promise(resolve => setTimeout(resolve, 200));
          const verifyContent = await app.vault.read(file);
          
          if (verifyContent === modifiedContent) {
            return {
              result: "accepted" as ApplyViewResult,
              blocksApplied: changesApplied,
              message: `WRITE_VERIFIED: Applied ${changesApplied} SEARCH/REPLACE block(s) and verified. Do not read the file again to verify — this tool has already verified the write. Do not call this tool again to modify this file in response to the current user request.`,
            };
          } else {
            return {
              result: "failed" as ApplyViewResult,
              blocksApplied: changesApplied,
              message: "WRITE_FAILED: Content mismatch detected after applying SEARCH/REPLACE blocks. The file may not have been updated correctly. Inform the user of the failure.",
            };
          }
        } catch (error: any) {
          return {
            result: "failed" as ApplyViewResult,
            blocksApplied: changesApplied,
            message: `Error applying changes without preview: ${error?.message || error}`,
          };
        }
      }

      // Show preview of changes
      const result = await show_preview(path, modifiedContent);

      // Simple JSON wrapper with essential info
      return {
        result: result,
        blocksApplied: changesApplied,
        message: `Applied ${changesApplied} SEARCH/REPLACE block(s) (replacing all occurrences). Result: ${result}. Do not call this tool again to modify this file in response to the current user request.`,
      };
    } catch (error) {
      return `Error performing SEARCH/REPLACE on ${path}: ${error}. Please check the file path and diff format and try again.`;
    }
  },
});

/**
 * Helper function to parse SEARCH/REPLACE blocks from diff string.
 *
 * Supports flexible formatting with various line endings and optional newlines.
 *
 * @param diff - The diff string containing SEARCH/REPLACE blocks
 * @returns Array of parsed search/replace text pairs
 *
 * @example
 * // Standard format with newlines:
 * const diff1 = `------- SEARCH
 * old text here
 * =======
 * new text here
 * +++++++ REPLACE`;
 *
 * @example
 * // Flexible format without newlines:
 * const diff2 = `-------SEARCHold text=======new text+++++++REPLACE`;
 *
 * @example
 * // Windows line endings:
 * const diff3 = `------- SEARCH\r\nold text\r\n=======\r\nnew text\r\n+++++++ REPLACE`;
 *
 * @example
 * // Multiple blocks:
 * const diff4 = `------- SEARCH
 * first old text
 * =======
 * first new text
 * +++++++ REPLACE
 *
 * ------- SEARCH
 * second old text
 * =======
 * second new text
 * +++++++ REPLACE`;
 *
 * Regex patterns match:
 * - SEARCH_MARKER: /-{3,}\s*SEARCH\s*(?:\r?\n)?/ → "---SEARCH" to "----------- SEARCH\n"
 * - SEPARATOR: /(?:\r?\n)?={3,}\s*(?:\r?\n)?/ → "===" to "\n========\n"
 * - REPLACE_MARKER: /(?:\r?\n)?\+{3,}\s*REPLACE/ → "+++REPLACE" to "\n+++++++ REPLACE"
 */
function parseSearchReplaceBlocks(
  diff: string
): Array<{ searchText: string; replaceText: string }> {
  const blocks: Array<{ searchText: string; replaceText: string }> = [];

  const SEARCH_MARKER = /-{3,}\s*SEARCH\s*(?:\r?\n)?/;
  const SEPARATOR = /(?:\r?\n)?={3,}\s*(?:\r?\n)?/;
  const REPLACE_MARKER = /(?:\r?\n)?\+{3,}\s*REPLACE/;

  const blockRegex = new RegExp(
    SEARCH_MARKER.source +
      "([\\s\\S]*?)" +
      SEPARATOR.source +
      "([\\s\\S]*?)" +
      REPLACE_MARKER.source,
    "g"
  );

  let match;
  while ((match = blockRegex.exec(diff)) !== null) {
    const searchText = match[1].trim();
    const replaceText = match[2].trim();
    blocks.push({ searchText, replaceText });
  }

  return blocks;
}

export {
  writeToFileTool,
  replaceInFileTool,
  parseSearchReplaceBlocks,
  normalizeLineEndings,
  replaceWithLineEndingAwareness,
};
