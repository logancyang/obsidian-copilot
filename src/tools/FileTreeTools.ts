import { tool } from "@langchain/core/tools";
import { TFile, TFolder, Vault } from "obsidian";
import { z } from "zod";

interface FileTreeNode {
  name: string;
  type: "file" | "folder";
  path: string;
  children?: FileTreeNode[];
}

function buildFileTree(folder: TFolder): FileTreeNode {
  const children: FileTreeNode[] = [];

  // Add folders first
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      children.push(buildFileTree(child));
    }
  }

  // Then add files
  for (const child of folder.children) {
    if (child instanceof TFile) {
      children.push({
        name: child.name,
        type: "file",
        path: child.path,
      });
    }
  }

  return {
    name: folder.name,
    type: "folder",
    path: folder.path,
    children: children,
  };
}

function getVaultFileTree(vault: Vault): FileTreeNode {
  return buildFileTree(vault.getRoot());
}

const createGetFileTreeTool = (vault: Vault) =>
  tool(
    async () => {
      const fileTree = getVaultFileTree(vault);
      return {
        fileTree,
        message: "Successfully retrieved vault file tree structure",
      };
    },
    {
      name: "getFileTree",
      description: "Get the complete file tree structure of the vault",
      schema: z.object({}),
    }
  );

export { createGetFileTreeTool };
export type { FileTreeNode };
