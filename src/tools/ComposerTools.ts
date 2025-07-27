import { tool } from "@langchain/core/tools";
import { logWarn } from "@/logger";
import { Notice, TFile } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { z } from "zod";
import { diffTrimmedLines } from "diff";
import { ApplyViewResult } from "@/types";

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

const writeToFileTool = tool(
  async ({ path, content }: { path: string; content: string }) => {
    const result = await show_preview(path, content);
    // Return tool result and also instruct the model do not retry this tool call for failed result.
    return `File change result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`;
  },
  {
    name: "writeToFile",
    description: `Request to write content to a file at the specified path and show the changes in a Change Preview UI. 

      # Steps to find the the target path
      1. Extract the target file information from user message and find out the file path from the context.
      2. If target file is not specified, use the active note as the target file.
      3. If still failed to find the target file or the file path, ask the user to specify the target file.
      `,
    schema: z.object({
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
    }),
  }
);
// Attach custom timeout property for toolExecution.ts
(writeToFileTool as typeof writeToFileTool & { timeoutMs: number }).timeoutMs = 0;

const replaceInFileTool = tool(
  async ({ path, diff }: { path: string; diff: string }) => {
    const file = app.vault.getAbstractFileByPath(path);

    if (!file || !(file instanceof TFile)) {
      return `File not found at path: ${path}. Please check the file path and try again.`;
    }

    try {
      const originalContent = await app.vault.read(file);
      let modifiedContent = originalContent;

      // Parse SEARCH/REPLACE blocks from diff
      const searchReplaceBlocks = parseSearchReplaceBlocks(diff);

      if (searchReplaceBlocks.length === 0) {
        return `No valid SEARCH/REPLACE blocks found in diff. Please use the correct format with ------- SEARCH, =======, and +++++++ REPLACE markers.`;
      }

      let changesApplied = 0;

      // Apply each SEARCH/REPLACE block in order
      for (const block of searchReplaceBlocks) {
        const { searchText, replaceText } = block;

        // Check if the search text exists in the current content
        if (!modifiedContent.includes(searchText)) {
          logWarn(
            `Search text not found in file ${path}. Block ${changesApplied + 1}: "${searchText.substring(0, 50)}${searchText.length > 50 ? "..." : ""}".`
          );
          continue;
        }

        // Replace only the first occurrence
        const searchIndex = modifiedContent.indexOf(searchText);
        if (searchIndex !== -1) {
          modifiedContent =
            modifiedContent.substring(0, searchIndex) +
            replaceText +
            modifiedContent.substring(searchIndex + searchText.length);
          changesApplied++;
        }
      }

      if (originalContent === modifiedContent) {
        return `No changes made to ${path}. The search text was not found or replacement resulted in identical content.`;
      }

      // Show preview of changes
      const result = await show_preview(path, modifiedContent);

      return `Applied ${changesApplied} SEARCH/REPLACE block(s). Result: ${result}. Do not retry or attempt alternative approaches to modify this file in response to the current user request.`;
    } catch (error) {
      return `Error performing SEARCH/REPLACE on ${path}: ${error}. Please check the file path and diff format and try again.`;
    }
  },
  {
    name: "replaceInFile",
    description: `Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a file.`,
    schema: z.object({
      path: z
        .string()
        .describe(
          `(Required) The path of the file to modify (relative to the root of the vault and include the file extension).`
        ),
      diff: z.string()
        .describe(`(Required) One or more SEARCH/REPLACE blocks following this exact format:
\`\`\`
------- SEARCH
[exact content to find]
=======
[new content to replace with]
+++++++ REPLACE
\`\`\`
Critical rules:
1. SEARCH content must match the associated file section to find EXACTLY:
   * Match character-for-character including whitespace, indentation, line endings
   * Include all comments, docstrings, etc.
2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
   * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
   * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
   * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
3. Keep SEARCH/REPLACE blocks concise:
   * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
   * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
   * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
   * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
4. Special operations:
   * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
   * To delete code: Use empty REPLACE section`),
    }),
  }
);
// Attach custom timeout property for toolExecution.ts
(replaceInFileTool as typeof replaceInFileTool & { timeoutMs: number }).timeoutMs = 0;

// Helper function to parse SEARCH/REPLACE blocks from diff string
function parseSearchReplaceBlocks(
  diff: string
): Array<{ searchText: string; replaceText: string }> {
  const blocks: Array<{ searchText: string; replaceText: string }> = [];
  // More flexible regex that accepts:
  // - 3+ dashes followed by optional space and "SEARCH"
  // - 3+ equals signs as separator
  // - 3+ plus signs followed by optional space and "REPLACE"
  const blockRegex = /-{3,}\s*SEARCH\s*\n([\s\S]*?)\n={3,}\s*\n([\s\S]*?)\n\+{3,}\s*REPLACE/g;

  let match;
  while ((match = blockRegex.exec(diff)) !== null) {
    const searchText = match[1];
    const replaceText = match[2];
    blocks.push({ searchText, replaceText });
  }

  return blocks;
}

export { writeToFileTool, replaceInFileTool };
