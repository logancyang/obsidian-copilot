import React from "react";
import { $isURLPillNode } from "../pills/URLPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

/**
 * Props for the URLPillSyncPlugin component
 */
interface URLPillSyncPluginProps {
  /** Callback triggered when the list of URL pills changes */
  onURLsChange?: (urls: string[]) => void;
  /** Callback triggered when URL pills are removed from the editor */
  onURLsRemoved?: (removedUrls: string[]) => void;
}

/**
 * Configuration for URL pill synchronization
 */
const urlPillConfig: PillSyncConfig<string> = {
  isPillNode: $isURLPillNode,
  extractData: (node: any) => node.getURL(),
};

/**
 * Lexical plugin that monitors URL pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to URL pills to keep external state in sync with editor content.
 */
export function URLPillSyncPlugin({ onURLsChange, onURLsRemoved }: URLPillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={urlPillConfig}
      onChange={onURLsChange}
      onRemoved={onURLsRemoved}
    />
  );
}
