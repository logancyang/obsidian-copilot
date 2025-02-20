import { tool } from "@langchain/core/tools";
import { TFile, TFolder } from "obsidian";
import { z } from "zod";
import { getSettings } from "../settings/model";

interface FileTreeNode {
  path: string;
  children?: FileTreeNode[];
}

function isTFolder(item: any): item is TFolder {
  return "children" in item && "path" in item;
}

function isTFile(item: any): item is TFile {
  return "path" in item && !("children" in item);
}

function buildFileTree(folder: TFolder): FileTreeNode {
  const useCompressedStructure = getSettings().enableCompressedVaultStructure;
  const nodePath = useCompressedStructure ? folder.name : folder.path;

  const node: FileTreeNode = {
    path: nodePath,
    children: [],
  };

  // Add folders first
  for (const child of folder.children) {
    if (isTFolder(child)) {
      node.children?.push(buildFileTree(child));
    }
  }

  // Then add files
  for (const child of folder.children) {
    if (isTFile(child)) {
      node.children?.push({
        path: useCompressedStructure ? child.name : child.path,
      });
    }
  }

  return node;
}

const createGetFileTreeTool = (root: TFolder) =>
  tool(
    async () => {
      return JSON.stringify(buildFileTree(root), null, 0);
    },
    {
      name: "getFileTree",
      description: "Get the complete file tree structure of the folder as JSON",
      schema: z.object({}),
    }
  );

export { createGetFileTreeTool, type FileTreeNode };
