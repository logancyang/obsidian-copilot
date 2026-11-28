import React from "react";
import {
  $isWebTabPillNode,
  WebTabPillNode,
} from "@/components/chat-components/pills/WebTabPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { WebTabContext } from "@/types/message";

interface WebTabPillSyncPluginProps {
  onWebTabsChange?: (webTabs: WebTabContext[]) => void;
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

export function WebTabPillSyncPlugin({ onWebTabsChange }: WebTabPillSyncPluginProps) {
  return <GenericPillSyncPlugin config={webTabPillConfig} onChange={onWebTabsChange} />;
}
