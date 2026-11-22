import type { App } from "obsidian";

import { logWarn } from "@/logger";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { WebTabContext } from "@/types/message";
import {
  normalizeUrlForMatching,
  normalizeUrlString,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";

export function buildWebTabsWithActiveSnapshot(
  app: App,
  existingWebTabs: WebTabContext[],
  shouldIncludeActiveWebTab: boolean
): WebTabContext[] {
  const sanitizedTabs = sanitizeWebTabContexts(existingWebTabs);

  if (!shouldIncludeActiveWebTab) {
    return sanitizedTabs;
  }

  try {
    const service = getWebViewerService(app);
    const state = service.getActiveWebTabState();
    const activeTab = state.activeWebTabForMentions;

    const activeUrl = normalizeUrlForMatching(activeTab?.url);
    if (!activeUrl) {
      return sanitizedTabs;
    }

    const clearedTabs: WebTabContext[] = sanitizedTabs.map((tab) => {
      if (tab.isActive) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ignore malformed candidates and continue to the next tab
        const { isActive: _unused, ...rest } = tab;
        return rest;
      }
      return tab;
    });

    const existingIndex = clearedTabs.findIndex(
      (tab) => normalizeUrlForMatching(tab.url) === activeUrl
    );

    if (existingIndex >= 0) {
      const existing = clearedTabs[existingIndex];
      clearedTabs[existingIndex] = {
        ...existing,
        url: normalizeUrlString(activeTab?.url) ?? existing.url,
        title: activeTab?.title ?? existing.title,
        faviconUrl: activeTab?.faviconUrl ?? existing.faviconUrl,
        isActive: true,
      };
      return clearedTabs;
    }

    return [
      ...clearedTabs,
      {
        url: normalizeUrlString(activeTab?.url) ?? activeUrl,
        title: activeTab?.title,
        faviconUrl: activeTab?.faviconUrl,
        isActive: true,
      },
    ];
  } catch (error) {
    logWarn("[ActiveWebTabSnapshot] Failed to resolve active web tab:", error);
    return sanitizedTabs;
  }
}
