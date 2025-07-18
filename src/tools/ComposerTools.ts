import { logError } from "@/logger";
import { tool } from "@langchain/core/tools";
import { Notice, TFile } from "obsidian";
import { APPLY_VIEW_TYPE } from "@/components/composer/ApplyView";
import { z } from "zod";
import { diffTrimmedLines } from "diff";

async function show_preview(
  file_path: string,
  content: string
): Promise<"accepted" | "rejected" | "aborted" | "failed"> {
  let file = app.vault.getAbstractFileByPath(file_path);
  let isNewFile = false;

  // If file doesn't exist, create it
  if (!file) {
    try {
      // Create the folder if it doesn't exist
      if (file_path.includes("/")) {
        const folderPath = file_path.split("/").slice(0, -1).join("/");
        const folder = app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
          await app.vault.createFolder(folderPath);
        }
      }
      file = await app.vault.create(file_path, content);
      if (file) {
        new Notice(`Created new file: ${file_path}`);
        isNewFile = true;
      } else {
        new Notice(`Failed to create file: ${file_path}`);
        return "aborted";
      }

      isNewFile = true;
    } catch (createError) {
      logError("Error creating file:", createError);
      new Notice(`Failed to create file: ${createError.message}`);
      return "aborted";
    }
  }

  if (!(file instanceof TFile)) {
    new Notice(`Path is not a file: ${file_path}`);
    return "aborted";
  }

  // Check if the current active note is the same as the target note
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile || activeFile.path !== file_path) {
    // If not, open the target file in the current leaf
    await app.workspace.getLeaf().openFile(file);
    new Notice(`Switched to ${file.name}`);
  }

  // If the file is newly created, don't show the apply view
  if (isNewFile) {
    return "accepted";
  }

  const originalContent = await app.vault.read(file);
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
        resultCallback: (result: "accepted" | "rejected" | "aborted" | "failed") => {
          resolve(result);
        },
      },
    });
  });
}

const writeToFileTool = tool(
  async ({ path, content }: { path: string; content: string }) => {
    const result = await show_preview(path, content);
    return `Result of the file changes: ${result}`;
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
(writeToFileTool as any).timeoutMs = 0;

export { writeToFileTool };
