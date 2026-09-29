import React from "react";
import {
  $isWebTabPillNode,
  WebTabPillNode,
} from "@/components/chat-components/pills/WebTabPillNode";
import { $isActiveWebTabPillNode } from "@/components/chat-components/pills/ActiveWebTabPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { WebTabContext } from "@/types/message";

interface WebTabPillSyncPluginProps {
  onWebTabsChange?: (webTabs: WebTabContext[]) => void;
  onWebTabsRemoved?: (removedWebTabs: WebTabContext[]) => void;
  onActiveWebTabAdded?: () => void;
  onActiveWebTabRemoved?: () => void;
}

const webTabPillConfig: PillSyncConfig<WebTabContext> = {
  isPillNode: $isWebTabPillNode,
  extractData: (node: WebTabPillNode): WebTabContext => ({
    url: node.getURL(),
    title: node.getTitle(),
    faviconUrl: node.getFaviconUrl(),
  }),
  getKey: (item: WebTabContext) => item.url,
  getChangeKey: (item: WebTabContext) =>
    [item.url, item.title ?? "", item.faviconUrl ?? ""].join("\n"),
};

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

function ActiveWebTabPillSyncPlugin({
  onActiveWebTabAdded,
  onActiveWebTabRemoved,
}: {
  onActiveWebTabAdded?: () => void;
  onActiveWebTabRemoved?: () => void;
}) {
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
