import { tool } from "@langchain/core/tools";
import { TFile, TFolder } from "obsidian";
import { z } from "zod";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";

type FileTreeNode = { [key: string]: string[] | FileTreeNode | (string[] | FileTreeNode)[] };

function isTFolder(item: any): item is TFolder {
  return "children" in item && "path" in item;
}

function isTFile(item: any): item is TFile {
  return "path" in item && !("children" in item);
}

function buildFileTree(folder: TFolder): FileTreeNode {
  const result: FileTreeNode = {};
  const files: string[] = [];
  const folders: FileTreeNode = {};

  // Get exclusion patterns from settings
  const { inclusions, exclusions } = getMatchingPatterns();

  // Separate files and folders
  for (const child of folder.children) {
    if (isTFile(child)) {
      // Only include file if it passes the pattern checks
      if (shouldIndexFile(child, inclusions, exclusions)) {
        files.push(child.name);
      }
    } else if (isTFolder(child)) {
      const subTree = buildFileTree(child);
      // Only include folder if it has any content after filtering
      if (Object.keys(subTree).length > 0) {
        Object.assign(folders, subTree);
      }
    }
  }

  // If this is root folder, name it "vault" and return merged result
  if (!folder.name) {
    // Only return if there's content after filtering
    if (files.length || Object.keys(folders).length) {
      return {
        vault: files.length ? (Object.keys(folders).length ? [files, folders] : files) : folders,
      };
    }
    return {};
  }

  // For named folders, nest everything under the folder name
  // Only include folder if it has any content after filtering
  if (files.length || Object.keys(folders).length) {
    result[folder.name] = files.length
      ? Object.keys(folders).length
        ? [files, folders]
        : files
      : folders;
  }

  return result;
}

const createGetFileTreeTool = (root: TFolder) =>
  tool(
    async () => {
      const prompt = `A JSON represents the file tree as a nested structure:
* The root object has a key "vault" which maps to an array with two items:
 * An array of files at the current directory.
 * An object of subdirectories, where each subdirectory follows the same structure as the root.

`;
      return prompt + JSON.stringify(buildFileTree(root));
    },
    {
      name: "getFileTree",
      description: "Get the file tree as JSON where folders are objects and files are arrays",
      schema: z.object({}),
    }
  );

export { createGetFileTreeTool, type FileTreeNode };
