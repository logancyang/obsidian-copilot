import React from "react";
import { $isURLPillNode, URLPillNode } from "@/components/chat-components/pills/URLPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface URLPillSyncPluginProps {
  onURLsChange?: (urls: string[]) => void;
  onURLsRemoved?: (removedUrls: string[]) => void;
}

const urlPillConfig: PillSyncConfig<string> = {
  isPillNode: $isURLPillNode,
  extractData: (node: LexicalNode) => (node as URLPillNode).getURL(),
};

export function URLPillSyncPlugin({ onURLsChange, onURLsRemoved }: URLPillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={urlPillConfig}
      onChange={onURLsChange}
      onRemoved={onURLsRemoved}
    />
  );
}
