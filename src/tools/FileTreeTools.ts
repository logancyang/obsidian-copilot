import { tool } from "@langchain/core/tools";
import { TFile, TFolder } from "obsidian";
import { z } from "zod";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";

interface FileTreeNode {
  files?: string[];
  subFolders?: Record<string, FileTreeNode>;
  extensionCounts?: Record<string, number>;
}

function isTFolder(item: any): item is TFolder {
  return "children" in item && "path" in item;
}

function isTFile(item: any): item is TFile {
  return "path" in item && !("children" in item);
}

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
}

function buildFileTree(
  folder: TFolder,
  includeFiles: boolean = true
): Record<string, FileTreeNode> {
  const files: string[] = [];
  const extensionCounts: Record<string, number> = {};
  const subFolders: Record<string, FileTreeNode> = {};

  // Get exclusion patterns from settings
  const { inclusions, exclusions } = getMatchingPatterns();

  // Separate files and folders
  for (const child of folder.children) {
    if (isTFile(child)) {
      // Only include file if it passes the pattern checks
      if (shouldIndexFile(child, inclusions, exclusions)) {
        // Only add to files array if we're including files
        if (includeFiles) {
          files.push(child.name);
        }

        // Always count file extensions
        const ext = getFileExtension(child.name) || "unknown";
        if (ext) {
          extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
        }
      }
    } else if (isTFolder(child)) {
      const subResult = buildFileTree(child, includeFiles);
      // Only include folder if it has any content after filtering
      if (Object.keys(subResult).length > 0) {
        subFolders[child.name] = subResult[child.name];

        // Merge extension counts from subfolders
        if (subResult[child.name].extensionCounts) {
          for (const [ext, count] of Object.entries(subResult[child.name].extensionCounts!)) {
            extensionCounts[ext] = (extensionCounts[ext] || 0) + count;
          }
        }
      }
    }
  }

  // If this is root folder, name it "vault" and return merged result
  // Create node for either root or named folder
  const node: FileTreeNode = {};

  if (Object.keys(extensionCounts).length > 0) {
    node.extensionCounts = extensionCounts;
  }

  if (includeFiles && files.length > 0) {
    node.files = files;
  }

  if (Object.keys(subFolders).length > 0) {
    node.subFolders = subFolders;
  }

  // If the FileTreeNode is empty, return an empty object
  if (Object.keys(node).length === 0) {
    return {};
  }

  if (folder.name) {
    return { [folder.name]: node };
  }

  return { vault: node };
}

const createGetFileTreeTool = (root: TFolder) =>
  tool(
    async () => {
      // First try building the tree with files included
      const tree = buildFileTree(root, true);

      const prompt = `A JSON represents the file tree as a nested structure:
* The root object has a key "vault" which contains a FileTreeNode object.
* Each FileTreeNode has these properties:
  * files: An array of filenames in the current directory (if any files exist)
  * subFolders: An object mapping folder names to their FileTreeNode objects (if any subfolders exist)
  * extensionCounts: An object with counts of file extensions in this folder and all subfolders

`;
      const jsonResult = JSON.stringify(tree);

      // If the file tree is larger than 0.5MB, use the simplified version instead.
      if (jsonResult.length > 500000) {
        // Rebuild tree without file lists
        const simplifiedTree = buildFileTree(root, false);
        return prompt + JSON.stringify(simplifiedTree);
      }

      return prompt + jsonResult;
    },
    {
      name: "getFileTree",
      description: "Get the file tree as a nested structure of folders and files",
      schema: z.void(),
    }
  );

export { createGetFileTreeTool, buildFileTree, type FileTreeNode };
