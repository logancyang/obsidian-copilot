import React from "react";
import { $isWebTabPillNode, WebTabPillNode } from "../pills/WebTabPillNode";
import { $isActiveWebTabPillNode } from "../pills/ActiveWebTabPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { WebTabContext } from "@/types/message";

/**
 * Props for the WebTabPillSyncPlugin component
 */
interface WebTabPillSyncPluginProps {
  /** Callback triggered when the list of web tab pills changes */
  onWebTabsChange?: (webTabs: WebTabContext[]) => void;
  /** Callback triggered when web tab pills are removed from the editor */
  onWebTabsRemoved?: (removedWebTabs: WebTabContext[]) => void;
  /** Callback triggered when an active web tab pill is added */
  onActiveWebTabAdded?: () => void;
  /** Callback triggered when an active web tab pill is removed */
  onActiveWebTabRemoved?: () => void;
}

/**
 * Configuration for web tab pill synchronization
 */
const webTabPillConfig: PillSyncConfig<WebTabContext> = {
  isPillNode: $isWebTabPillNode,
  extractData: (node: WebTabPillNode): WebTabContext => ({
    url: node.getURL(),
    title: node.getTitle(),
    faviconUrl: node.getFaviconUrl(),
  }),
  // Identity key: URL uniquely identifies a web tab
  getKey: (item: WebTabContext) => item.url,
  // Change key: includes all metadata for detecting title/favicon updates
  getChangeKey: (item: WebTabContext) =>
    [item.url, item.title ?? "", item.faviconUrl ?? ""].join("\n"),
};

/**
 * Lexical plugin that monitors web tab pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to web tab pills to keep external state in sync with editor content.
 *
 * Also monitors ActiveWebTabPillNode separately since it needs different handling.
 */
export function WebTabPillSyncPlugin({
  onWebTabsChange,
  onWebTabsRemoved,
  onActiveWebTabAdded,
  onActiveWebTabRemoved,
}: WebTabPillSyncPluginProps) {
  return (
    <>
      <GenericPillSyncPlugin
        config={webTabPillConfig}
        onChange={onWebTabsChange}
        onRemoved={onWebTabsRemoved}
      />
      {(onActiveWebTabAdded || onActiveWebTabRemoved) && (
        <ActiveWebTabPillSyncPlugin
          onActiveWebTabAdded={onActiveWebTabAdded}
          onActiveWebTabRemoved={onActiveWebTabRemoved}
        />
      )}
    </>
  );
}

/**
 * Internal plugin to track ActiveWebTabPillNode presence
 */
function ActiveWebTabPillSyncPlugin({
  onActiveWebTabAdded,
  onActiveWebTabRemoved,
}: {
  onActiveWebTabAdded?: () => void;
  onActiveWebTabRemoved?: () => void;
}) {
  // Use GenericPillSyncPlugin with a simple boolean-like config
  const config: PillSyncConfig<boolean> = {
    isPillNode: $isActiveWebTabPillNode,
    extractData: () => true,
    getKey: () => "active-web-tab",
  };

  const handleChange = React.useCallback(
    (items: boolean[]) => {
      if (items.length > 0 && onActiveWebTabAdded) {
        onActiveWebTabAdded();
      }
    },
    [onActiveWebTabAdded]
  );

  const handleRemoved = React.useCallback(
    (removedItems: boolean[]) => {
      if (removedItems.length > 0 && onActiveWebTabRemoved) {
        onActiveWebTabRemoved();
      }
    },
    [onActiveWebTabRemoved]
  );

  return (
    <GenericPillSyncPlugin config={config} onChange={handleChange} onRemoved={handleRemoved} />
  );
}
