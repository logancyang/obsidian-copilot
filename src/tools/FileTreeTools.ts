import { tool } from "@langchain/core/tools";
import { TFile, TFolder } from "obsidian";
import { z } from "zod";

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
  const node: FileTreeNode = {
    path: folder.path,
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
        path: child.path,
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
