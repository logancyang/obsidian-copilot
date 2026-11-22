import { useEffect, useRef, useState } from "react";
import { App } from "obsidian";
import { useApp } from "@/context";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import type { WebTabContext } from "@/types/message";

const WEB_TAB_FALLBACK_POLL_INTERVAL_MS = 6_000;

export interface UseOpenWebTabsOptions {
  enabled?: boolean;
}

function getOpenWebTabSnapshot(app: App): WebTabContext[] {
  try {
    const service = getWebViewerService(app);
    const leaves = service.getLeaves();

    const tabs: WebTabContext[] = [];
    for (const leaf of leaves) {
      const info = service.getPageInfo(leaf);

      const view = leaf.view as {
        webviewMounted?: boolean;
        webviewFirstLoadFinished?: boolean;
      };

      const hasUrl = Boolean(info.url?.trim());
      const hasTitle = Boolean(info.title?.trim());

      if (!hasUrl && !hasTitle) {
        continue;
      }

      const webviewReady =
        view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
          ? true
          : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
      const isLoaded = hasUrl && webviewReady;

      tabs.push({
        url: info.url || "",
        title: info.title || undefined,
        faviconUrl: info.faviconUrl || undefined,
        isLoaded,
      });
    }

    tabs.sort((a, b) => {
      if (a.isLoaded !== b.isLoaded) {
        return a.isLoaded ? -1 : 1;
      }
      const aKey = a.url || a.title || "";
      const bKey = b.url || b.title || "";
      return aKey.localeCompare(bKey);
    });

    return tabs;
  } catch {
    return [];
  }
}

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

export function useOpenWebTabs(options: UseOpenWebTabsOptions = {}): WebTabContext[] {
  const app = useApp();
  const { enabled = true } = options;
  const [tabs, setTabs] = useState<WebTabContext[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTabs([]);
      return;
    }

    if (!isDesktopRuntime()) {
      setTabs([]);
      return;
    }

    let disposed = false;

    const refresh = () => {
      if (disposed) return;
      const next = getOpenWebTabSnapshot(app);
      setTabs((prev) => (areWebTabSnapshotsEqual(prev, next) ? prev : next));
    };

    const scheduleRefresh = () => {
      if (disposed) return;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        refresh();
      });
    };

    refresh();

    const service = getWebViewerService(app);
    const unsubscribeWebviewLoad = service.subscribeToWebviewLoad(scheduleRefresh);

    const layoutRef = app.workspace.on("layout-change", scheduleRefresh);
    const activeLeafRef = app.workspace.on("active-leaf-change", scheduleRefresh);

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
  }, [app, enabled]);

  return tabs;
}
