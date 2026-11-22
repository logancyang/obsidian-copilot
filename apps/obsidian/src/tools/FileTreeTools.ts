import { App, TFile, TFolder } from "obsidian";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import * as z from "zod";
import { createLangChainTool } from "./createLangChainTool";

interface FileTreeNode {
  files?: string[];
  subFolders?: Record<string, FileTreeNode>;
  extensionCounts?: Record<string, number>;
}

function isTFolder(item: unknown): item is TFolder {
  return typeof item === "object" && item !== null && "children" in item && "path" in item;
}

function isTFile(item: unknown): item is TFile {
  return typeof item === "object" && item !== null && "path" in item && !("children" in item);
}

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
}

function buildFileTree(
  app: App,
  folder: TFolder,
  includeFiles: boolean = true
): Record<string, FileTreeNode> {
  const files: string[] = [];
  const extensionCounts: Record<string, number> = {};
  const subFolders: Record<string, FileTreeNode> = {};

  const { inclusions, exclusions } = getMatchingPatterns();

  for (const child of folder.children) {
    if (isTFile(child)) {
      if (shouldIndexFile(app, child, inclusions, exclusions)) {
        if (includeFiles) {
          files.push(child.name);
        }

        const ext = getFileExtension(child.name) || "unknown";
        if (ext) {
          extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
        }
      }
    } else if (isTFolder(child)) {
      const subResult = buildFileTree(app, child, includeFiles);
      if (Object.keys(subResult).length > 0) {
        subFolders[child.name] = subResult[child.name];

        if (subResult[child.name].extensionCounts) {
          for (const [ext, count] of Object.entries(subResult[child.name].extensionCounts!)) {
            extensionCounts[ext] = (extensionCounts[ext] || 0) + count;
          }
        }
      }
    }
  }

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

  if (Object.keys(node).length === 0) {
    return {};
  }

  if (folder.name) {
    return { [folder.name]: node };
  }

  return { vault: node };
}

const createGetFileTreeTool = (app: App, root: TFolder) =>
  createLangChainTool({
    name: "getFileTree",
    description: "Get the file tree as a nested structure of folders and files",
    schema: z.object({}),
    func: async () => {
      const tree = buildFileTree(app, root, true);

      const prompt = `A JSON represents the file tree as a nested structure:
* The root object has a key "vault" which contains a FileTreeNode object.
* Each FileTreeNode has these properties:
  * files: An array of filenames in the current directory (if any files exist)
  * subFolders: An object mapping folder names to their FileTreeNode objects (if any subfolders exist)
  * extensionCounts: An object with counts of file extensions in this folder and all subfolders

`;
      const jsonResult = JSON.stringify(tree);

      if (jsonResult.length > 500000) {
        const simplifiedTree = buildFileTree(app, root, false);
        return prompt + JSON.stringify(simplifiedTree);
      }

      return prompt + jsonResult;
    },
  });

export { createGetFileTreeTool, buildFileTree, type FileTreeNode };
