import React from "react";
import {
  $isFolderPillNode,
  FolderPillNode,
} from "@/components/chat-components/pills/FolderPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface FolderPillSyncPluginProps {
  onFoldersChange?: (folders: string[]) => void;
}

const folderPillConfig: PillSyncConfig<string> = {
  isPillNode: $isFolderPillNode,
  extractData: (node: LexicalNode) => (node as FolderPillNode).getFolderPath(),
};

export function FolderPillSyncPlugin({ onFoldersChange }: FolderPillSyncPluginProps) {
  return <GenericPillSyncPlugin config={folderPillConfig} onChange={onFoldersChange} />;
}
