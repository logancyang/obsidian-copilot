import React from "react";
import { $isFolderPillNode } from "../pills/FolderPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

/**
 * Props for the FolderPillSyncPlugin component
 */
interface FolderPillSyncPluginProps {
  /** Callback triggered when the list of folder pills changes */
  onFoldersChange?: (folders: string[]) => void;
  /** Callback triggered when folder pills are removed from the editor */
  onFoldersRemoved?: (removedFolders: string[]) => void;
}

/**
 * Configuration for folder pill synchronization
 */
const folderPillConfig: PillSyncConfig<string> = {
  isPillNode: $isFolderPillNode,
  extractData: (node: any) => node.getFolderPath(),
};

/**
 * Lexical plugin that monitors folder pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to folder pills to keep external state in sync with editor content.
 */
export function FolderPillSyncPlugin({
  onFoldersChange,
  onFoldersRemoved,
}: FolderPillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={folderPillConfig}
      onChange={onFoldersChange}
      onRemoved={onFoldersRemoved}
    />
  );
}
