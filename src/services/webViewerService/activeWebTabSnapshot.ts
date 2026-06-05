/**
 * Active Web Tab snapshot resolution.
 *
 * Shared by the legacy chat (`ChatManager`) and Agent Mode (`AgentChatInput`).
 * Resolves the current Active Web Tab into the outgoing `webTabs` list with
 * snapshot semantics: the active tab's URL is captured at message-creation
 * time and marked `isActive: true`, so a later edit/reprocess uses the stored
 * URL rather than whatever tab happens to be active then.
 */

import type { App } from "obsidian";

import { logWarn } from "@/logger";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { WebTabContext } from "@/types/message";
import {
  normalizeUrlForMatching,
  normalizeUrlString,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";

/**
 * Merge the Active Web Tab into `existingWebTabs` when requested.
 *
 * Always sanitizes the incoming tabs (normalizes URLs, dedupes, enforces a
 * single `isActive`). When `shouldIncludeActiveWebTab` is true, resolves the
 * active tab from {@link getWebViewerService} and either marks the matching
 * existing entry active or appends a new active entry. Web Viewer being
 * unavailable (e.g. mobile) is non-fatal: the sanitized tabs are returned
 * unchanged.
 */
export function buildWebTabsWithActiveSnapshot(
  app: App,
  existingWebTabs: WebTabContext[],
  shouldIncludeActiveWebTab: boolean
): WebTabContext[] {
  // Always sanitize existing webTabs (normalize URLs, dedupe, ensure single isActive)
  const sanitizedTabs = sanitizeWebTabContexts(existingWebTabs);

  if (!shouldIncludeActiveWebTab) {
    return sanitizedTabs;
  }

  try {
    // Get active web tab from WebViewerService
    // Use activeWebTabForMentions to match UI behavior:
    // - Preserved only when switching directly to chat panel
    // - Cleared when switching to other views (e.g., note tab)
    const service = getWebViewerService(app);
    const state = service.getActiveWebTabState();
    const activeTab = state.activeWebTabForMentions;

    const activeUrl = normalizeUrlForMatching(activeTab?.url);
    if (!activeUrl) {
      // No active web tab available, return sanitized tabs unchanged
      return sanitizedTabs;
    }

    // Clear any existing isActive flags to ensure only one active tab
    const clearedTabs: WebTabContext[] = sanitizedTabs.map((tab) => {
      if (tab.isActive) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { isActive: _unused, ...rest } = tab;
        return rest;
      }
      return tab;
    });

    // Check if active URL already exists in the list (using normalized matching)
    const existingIndex = clearedTabs.findIndex(
      (tab) => normalizeUrlForMatching(tab.url) === activeUrl
    );

    if (existingIndex >= 0) {
      // Merge metadata and mark as active
      // Prefer activeTab.url to preserve hash fragments for SPA routing
      // Use normalizeUrlString to trim whitespace while keeping hash/query intact
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

    // Add new active tab entry
    // Store the raw URL to preserve hash fragments and query params for SPA routing
    // Use normalizeUrlString to trim whitespace while keeping hash/query intact
    // (activeUrl is only used for comparison/deduplication above)
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
    // Web Viewer not available (e.g., mobile platform) - don't fail the message
    logWarn("[ActiveWebTabSnapshot] Failed to resolve active web tab:", error);
    return sanitizedTabs;
  }
}
