import { tool } from "@langchain/core/tools";
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
    return `File change result: ${result}` + (result === "accepted"
      ? ""
      : "Do not call writeToFile again for this operation.");
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

export { writeToFileTool };
