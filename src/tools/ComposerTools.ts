import { Notice, TFile } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { diffTrimmedLines } from "diff";
import { ApplyViewResult } from "@/types";
import { z } from "zod";
import { createTool } from "./SimpleTool";

async function show_preview(file_path: string, content: string): Promise<ApplyViewResult> {
  const file = app.vault.getAbstractFileByPath(file_path);

  // Check if the current active note is the same as the target note
  const activeFile = app.workspace.getActiveFile();
  if (file && (!activeFile || activeFile.path !== file_path)) {
    // If not, open the target file in the current leaf
    await app.workspace.getLeaf().openFile(file as TFile);
    new Notice(`Switched to ${file.name}`);
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
  content: z.string().describe(`(Required) The content to write to the file. 
          ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. 
          You MUST include ALL parts of the file, even if they haven't been modified.

          # Rules for Obsidian Canvas content
          * For canvas files, both 'nodes' and 'edges' arrays must be properly closed with ]
          * Every node must have: id, type, x, y, width, height
          * Every edge must have: id, fromNode, toNode
          * All IDs must be unique
          * Edge fromNode and toNode must reference existing node IDs
          
          # Example content of a canvas file
          {
            "nodes": [
              {
                "id": "1",
                "type": "text",
                "text": "Hello, world!",
                "x": 0,
                "y": 0,
                "width": 200,
                "height": 50
              }
            ],
            "edges": [
              {
                "id": "e1-2",
                "fromNode": "1",
                "toNode": "2",
                "label": "connects to"
              }
            ]
          }`),
});

const writeToFileTool = createTool({
  name: "writeToFile",
  description: `Request to write content to a file at the specified path and show the changes in a Change Preview UI. 

      # Steps to find the the target path
      1. Extract the target file information from user message and find out the file path from the context.
      2. If target file is not specified, use the active note as the target file.
      3. If still failed to find the target file or the file path, ask the user to specify the target file.
      `,
  schema: writeToFileSchema,
  handler: async ({ path, content }) => {
    const result = await show_preview(path, content);
    // Simple JSON wrapper for consistent parsing
    return JSON.stringify({
      result: result,
      message: `File change result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`,
    });
  },
  timeoutMs: 0, // no timeout
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

const replaceInFileTool = createTool({
  name: "replaceInFile",
  description: `Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a LARGE file.`,
  schema: replaceInFileSchema,
  handler: async ({ path, diff }: { path: string; diff: string }) => {
    const file = app.vault.getAbstractFileByPath(path);

    if (!file || !(file instanceof TFile)) {
      return `File not found at path: ${path}. Please check the file path and try again.`;
    }

    try {
      const originalContent = await app.vault.read(file);
      let modifiedContent = originalContent;

      // Reject this tool if the original content is small
      const MIN_FILE_SIZE_FOR_REPLACE = 3000; // Files smaller than 3KB should use writeToFile for simplicity
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

      // Show preview of changes
      const result = await show_preview(path, modifiedContent);

      // Simple JSON wrapper with essential info
      return JSON.stringify({
        result: result,
        blocksApplied: changesApplied,
        message: `Applied ${changesApplied} SEARCH/REPLACE block(s) (replacing all occurrences). Result: ${result}. Do not call this tool again to modify this file in response to the current user request.`,
      });
    } catch (error) {
      return `Error performing SEARCH/REPLACE on ${path}: ${error}. Please check the file path and diff format and try again.`;
    }
  },
  timeoutMs: 0, // no timeout
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
