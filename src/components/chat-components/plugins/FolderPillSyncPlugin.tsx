import React from "react";
import {
  $isFolderPillNode,
  FolderPillNode,
} from "@/components/chat-components/pills/FolderPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface FolderPillSyncPluginProps {
  onFoldersChange?: (folders: string[]) => void;
  onFoldersRemoved?: (removedFolders: string[]) => void;
}

const folderPillConfig: PillSyncConfig<string> = {
  isPillNode: $isFolderPillNode,
  extractData: (node: LexicalNode) => (node as FolderPillNode).getFolderPath(),
};

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
