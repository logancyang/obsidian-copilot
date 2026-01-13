import { useEffect, useRef, useState } from "react";
import { Platform } from "obsidian";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { WebTabContext } from "@/types/message";

/**
 * Fallback poll interval for refreshing Web Viewer tab metadata (title/url/favicon).
 * Primary updates come from workspace events and webview load events.
 * Polling is only needed to catch rare title changes after initial load.
 */
const WEB_TAB_FALLBACK_POLL_INTERVAL_MS = 6_000;

/**
 * Options for useOpenWebTabs hook.
 */
export interface UseOpenWebTabsOptions {
  /**
   * Whether polling/subscriptions are enabled (default: true).
   * When false, the hook returns an empty array and does not start polling.
   */
  enabled?: boolean;
}

/**
 * Create a stable, sorted snapshot of open Web Viewer tabs.
 * Sorting ensures stable output ordering for equality checks.
 * Includes tabs with title but no URL (not yet loaded) with isLoaded=false.
 */
function getOpenWebTabSnapshot(): WebTabContext[] {
  try {
    const service = getWebViewerService(app);
    const leaves = service.getLeaves();

    const tabs: WebTabContext[] = [];
    for (const leaf of leaves) {
      const info = service.getPageInfo(leaf);

      // Access webview state to determine if tab is fully loaded
      const view = leaf.view as {
        webviewMounted?: boolean;
        webviewFirstLoadFinished?: boolean;
      };

      const hasUrl = Boolean(info.url?.trim());
      const hasTitle = Boolean(info.title?.trim());

      // Skip tabs that have neither URL nor title (completely empty)
      if (!hasUrl && !hasTitle) {
        continue;
      }

      // Determine if tab content is loaded
      // Note: webviewMounted/webviewFirstLoadFinished are internal Obsidian fields
      // If they don't exist, assume loaded (fallback to old behavior)
      const webviewReady =
        view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
          ? true // Fallback: assume ready if fields don't exist
          : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
      const isLoaded = hasUrl && webviewReady;

      tabs.push({
        url: info.url || "",
        title: info.title || undefined,
        faviconUrl: info.faviconUrl || undefined,
        isLoaded,
      });
    }

    // Sort: loaded tabs first (by URL), then unloaded tabs (by title)
    tabs.sort((a, b) => {
      // Loaded tabs come before unloaded
      if (a.isLoaded !== b.isLoaded) {
        return a.isLoaded ? -1 : 1;
      }
      // Within same load state, sort by URL or title
      const aKey = a.url || a.title || "";
      const bKey = b.url || b.title || "";
      return aKey.localeCompare(bKey);
    });

    return tabs;
  } catch {
    return [];
  }
}

/**
 * Compare two WebTabContext arrays for deep equality.
 */
function areWebTabSnapshotsEqual(a: WebTabContext[], b: WebTabContext[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai.url !== bi.url) return false;
    if (ai.title !== bi.title) return false;
    if (ai.faviconUrl !== bi.faviconUrl) return false;
    if (ai.isLoaded !== bi.isLoaded) return false;
  }
  return true;
}

/**
 * Hook that returns currently open web tabs from Web Viewer.
 * Desktop-only - returns empty array on mobile.
 *
 * Features:
 * - Subscribes to layout-change (new/closed tabs) and active-leaf-change
 * - Falls back to low-frequency polling (6s) to catch title/URL updates after page load
 * - Deep comparison to avoid unnecessary rerenders
 * - Supports enabled option to disable polling when not needed
 *
 * @param options - Configuration options
 * @param options.enabled - Whether to enable polling (default: true)
 */
export function useOpenWebTabs(options: UseOpenWebTabsOptions = {}): WebTabContext[] {
  const { enabled = true } = options;
  const [tabs, setTabs] = useState<WebTabContext[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    // If disabled, return empty array and don't start polling
    if (!enabled) {
      setTabs([]);
      return;
    }

    // Web Viewer is desktop-only
    if (!Platform.isDesktopApp) {
      setTabs([]);
      return;
    }

    let disposed = false;

    /** Refresh state from the current Web Viewer tab snapshot. */
    const refresh = () => {
      if (disposed) return;
      const next = getOpenWebTabSnapshot();
      setTabs((prev) => (areWebTabSnapshotsEqual(prev, next) ? prev : next));
    };

    /** Coalesce multiple refresh triggers into a single render tick. */
    const scheduleRefresh = () => {
      if (disposed) return;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        refresh();
      });
    };

    // Initial snapshot
    refresh();

    // Subscribe to webview load events from WebViewerStateManager (single source of truth)
    const service = getWebViewerService(app);
    const unsubscribeWebviewLoad = service.subscribeToWebviewLoad(scheduleRefresh);

    // Subscribe to workspace events
    const layoutRef = app.workspace.on("layout-change", scheduleRefresh);
    const activeLeafRef = app.workspace.on("active-leaf-change", scheduleRefresh);

    // Low-frequency fallback poll for rare title changes after initial load
    const intervalId = window.setInterval(scheduleRefresh, WEB_TAB_FALLBACK_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      window.clearInterval(intervalId);
      app.workspace.offref(layoutRef);
      app.workspace.offref(activeLeafRef);
      unsubscribeWebviewLoad();
    };
  }, [enabled]);

  return tabs;
}
