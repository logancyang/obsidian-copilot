import type { App, WorkspaceLeaf } from "obsidian";

import { logWarn } from "@/logger";
import { isLeafStillOpen } from "@/services/webViewerService/webViewerServiceHelpers";
import {
  isWebViewerLeaf,
  type ActiveWebTabStateListener,
  type ActiveWebTabStateSnapshot,
  type ActiveWebTabTrackingRefs,
  type StartActiveWebTabTrackingOptions,
  type WebViewerLeaf,
  type WebViewerPageInfo,
} from "@/services/webViewerService/webViewerServiceTypes";
import { normalizeUrlForMatching } from "@/utils/urlNormalization";
import type { WebTabContext } from "@/types/message";

const WEBVIEW_METADATA_EVENTS = [
  "did-finish-load",
  "page-favicon-updated",
  "page-title-updated",
] as const;

type WebviewMetadataEventName = (typeof WEBVIEW_METADATA_EVENTS)[number];

interface WebviewLoadListenerEntry {
  leaf: WebViewerLeaf;
  handler: () => void;
  events: ReadonlyArray<WebviewMetadataEventName>;
}

type RecomputeActiveWebTabStateParams =
  | { trigger: "active-leaf-change"; activeLeaf: WorkspaceLeaf | null }
  | { trigger: "layout-change" }
  | { trigger: "webview-metadata"; loadedLeaf: WebViewerLeaf };

export interface WebViewerStateManagerDeps {
  app: App;
  isSupportedPlatform: () => boolean;
  getActiveLeaf: () => WebViewerLeaf | null;
  getLeaves: () => WebViewerLeaf[];
  getPageInfo: (leaf: WebViewerLeaf) => WebViewerPageInfo;
}

export class WebViewerStateManager {
  private readonly app: App;
  private readonly isSupportedPlatform: () => boolean;
  private readonly getActiveLeaf: () => WebViewerLeaf | null;
  private readonly getLeaves: () => WebViewerLeaf[];
  private readonly getPageInfo: (leaf: WebViewerLeaf) => WebViewerPageInfo;

  private lastActiveLeaf: WebViewerLeaf | null = null;

  private activeWebTabState: ActiveWebTabStateSnapshot = {
    activeWebTabForMentions: null,
    activeOrLastWebTab: null,
  };
  private activeWebTabLeaf: WebViewerLeaf | null = null;
  private activeWebTabListeners: Set<ActiveWebTabStateListener> = new Set();
  private activeWebTabTrackingRefs: ActiveWebTabTrackingRefs | null = null;
  private activeWebTabTrackingPreserveViewTypes: string[] = [];
  private webviewLoadListeners: Map<HTMLElement, WebviewLoadListenerEntry> = new Map();
  private webviewLoadCallbacks: Set<() => void> = new Set();
  private cancelScheduledWebviewLoadNotify: (() => void) | null = null;

  constructor(deps: WebViewerStateManagerDeps) {
    this.app = deps.app;
    this.isSupportedPlatform = deps.isSupportedPlatform;
    this.getActiveLeaf = deps.getActiveLeaf;
    this.getLeaves = deps.getLeaves;
    this.getPageInfo = deps.getPageInfo;
  }

  getLastActiveLeaf(): WebViewerLeaf | null {
    const leaf = this.lastActiveLeaf;
    if (!leaf || !isWebViewerLeaf(leaf)) {
      this.lastActiveLeaf = null;
      return null;
    }

    if (!isLeafStillOpen(this.app, leaf)) {
      this.lastActiveLeaf = null;
      return null;
    }

    return leaf;
  }

  findLeafByUrl(url: string, options: { title?: string } = {}): WebViewerLeaf | null {
    const targetRaw = url.trim();
    if (!targetRaw) return null;

    const leaves = this.getLeaves();

    for (const leaf of leaves) {
      if (leaf?.view?.url === targetRaw) return leaf;
    }

    const targetNormalized = normalizeUrlForMatching(targetRaw);
    if (!targetNormalized) return null;

    const matchedLeaves: WebViewerLeaf[] = [];
    for (const leaf of leaves) {
      const leafUrl = leaf?.view?.url;
      if (!leafUrl) continue;

      const leafNormalized = normalizeUrlForMatching(leafUrl);
      if (leafNormalized === targetNormalized) {
        matchedLeaves.push(leaf);
      }
    }

    if (matchedLeaves.length === 0) {
      return null;
    }

    if (matchedLeaves.length === 1) {
      return matchedLeaves[0];
    }

    const titleHint = (options.title ?? "").trim();
    if (titleHint) {
      const titleHintLower = titleHint.toLowerCase();
      const titleMatchedLeaves: WebViewerLeaf[] = [];

      for (const leaf of matchedLeaves) {
        try {
          const info = this.getPageInfo(leaf);
          const leafTitle = (info.title || "").trim();
          if (leafTitle && leafTitle.toLowerCase() === titleHintLower) {
            titleMatchedLeaves.push(leaf);
          }
        } catch {
          // Ignore and continue scanning other leaves
        }
      }

      if (titleMatchedLeaves.length === 1) {
        return titleMatchedLeaves[0];
      }

      if (titleMatchedLeaves.length > 1) {
        const activeLeaf = this.getActiveLeaf();
        if (activeLeaf && titleMatchedLeaves.includes(activeLeaf)) {
          return activeLeaf;
        }

        const lastActiveLeaf = this.getLastActiveLeaf();
        if (lastActiveLeaf && titleMatchedLeaves.includes(lastActiveLeaf)) {
          return lastActiveLeaf;
        }

        logWarn(
          "[WebViewerStateManager] Multiple leaves matched URL + title; returning first match.",
          {
            url: targetRaw,
            title: titleHint,
            matches: titleMatchedLeaves.length,
          }
        );
        return titleMatchedLeaves[0];
      }
    }

    const activeLeaf = this.getActiveLeaf();
    if (activeLeaf && matchedLeaves.includes(activeLeaf)) {
      return activeLeaf;
    }

    const lastActiveLeaf = this.getLastActiveLeaf();
    if (lastActiveLeaf && matchedLeaves.includes(lastActiveLeaf)) {
      return lastActiveLeaf;
    }

    logWarn(
      "[WebViewerStateManager] Multiple leaves matched URL; returning first match as fallback.",
      {
        url: targetRaw,
        matches: matchedLeaves.length,
      }
    );
    return matchedLeaves[0];
  }

  getActiveWebTabState(): ActiveWebTabStateSnapshot {
    return this.activeWebTabState;
  }

  subscribeActiveWebTabState(listener: ActiveWebTabStateListener): () => void {
    this.activeWebTabListeners.add(listener);
    return () => {
      this.activeWebTabListeners.delete(listener);
    };
  }

  subscribeToWebviewLoad(callback: () => void): () => void {
    this.webviewLoadCallbacks.add(callback);
    return () => {
      this.webviewLoadCallbacks.delete(callback);
    };
  }

  startActiveWebTabTracking(
    options: StartActiveWebTabTrackingOptions = {}
  ): ActiveWebTabTrackingRefs {
    if (this.activeWebTabTrackingRefs) {
      this.stopActiveWebTabTracking();
    }

    this.activeWebTabTrackingPreserveViewTypes = [...(options.preserveOnViewTypes ?? [])];

    const activeLeafRef = this.app.workspace.on(
      "active-leaf-change",
      (leaf: WorkspaceLeaf | null) => {
        try {
          if (isWebViewerLeaf(leaf)) this.lastActiveLeaf = leaf;
        } catch (err) {
          logWarn("WebViewerStateManager failed to track active leaf:", err);
        }

        this.recomputeActiveWebTabState({ trigger: "active-leaf-change", activeLeaf: leaf });
        this.subscribeToWebviewLoadEvents();
      }
    );

    const layoutRef = this.app.workspace.on("layout-change", () => {
      this.recomputeActiveWebTabState({ trigger: "layout-change" });
      this.subscribeToWebviewLoadEvents();
    });

    this.activeWebTabTrackingRefs = { activeLeafRef, layoutRef };

    this.recomputeActiveWebTabState({
      trigger: "active-leaf-change",
      activeLeaf: this.app.workspace.getMostRecentLeaf(),
    });
    this.subscribeToWebviewLoadEvents();

    return this.activeWebTabTrackingRefs;
  }

  private subscribeToWebviewLoadEvents(): void {
    if (!this.isSupportedPlatform()) {
      this.cleanupWebviewLoadListeners();
      return;
    }

    try {
      const leaves = this.getLeaves();
      const nextWebviews = new Set<HTMLElement>();

      for (const leaf of leaves) {
        const webview = leaf.view?.webview as HTMLElement | undefined;
        if (
          webview &&
          typeof webview.addEventListener === "function" &&
          typeof webview.removeEventListener === "function"
        ) {
          nextWebviews.add(webview);

          const existing = this.webviewLoadListeners.get(webview);
          if (existing && existing.leaf === leaf) {
            continue;
          }

          if (existing) {
            for (const event of existing.events) {
              webview.removeEventListener(event, existing.handler);
            }
            this.webviewLoadListeners.delete(webview);
          }

          const handler = () => {
            this.recomputeActiveWebTabState({ trigger: "webview-metadata", loadedLeaf: leaf });
            this.scheduleWebviewLoadCallbackNotification();
          };

          const entry: WebviewLoadListenerEntry = {
            leaf,
            handler,
            events: WEBVIEW_METADATA_EVENTS,
          };

          for (const event of entry.events) {
            webview.addEventListener(event, handler);
          }

          this.webviewLoadListeners.set(webview, entry);
        }
      }

      const staleWebviews: HTMLElement[] = [];
      for (const webview of this.webviewLoadListeners.keys()) {
        if (!nextWebviews.has(webview)) {
          staleWebviews.push(webview);
        }
      }

      for (const webview of staleWebviews) {
        const entry = this.webviewLoadListeners.get(webview);
        if (!entry) continue;

        try {
          for (const event of entry.events) {
            webview.removeEventListener(event, entry.handler);
          }
        } catch {
          // Ignore cleanup errors
        }

        this.webviewLoadListeners.delete(webview);
      }
    } catch {
      // Ignore errors
    }
  }

  private cleanupWebviewLoadListeners(): void {
    for (const [webview, { handler, events }] of this.webviewLoadListeners) {
      try {
        if (typeof webview.removeEventListener === "function") {
          for (const event of events) {
            webview.removeEventListener(event, handler);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.webviewLoadListeners.clear();
  }

  private scheduleWebviewLoadCallbackNotification(): void {
    if (this.cancelScheduledWebviewLoadNotify) {
      return;
    }

    const schedule = (fn: () => void): (() => void) => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        const id = window.requestAnimationFrame(() => fn());
        return () => window.cancelAnimationFrame(id);
      }
      const id = window.setTimeout(fn, 0);
      return () => window.clearTimeout(id);
    };

    this.cancelScheduledWebviewLoadNotify = schedule(() => {
      this.cancelScheduledWebviewLoadNotify = null;
      this.notifyWebviewLoadCallbacks();
    });
  }

  private notifyWebviewLoadCallbacks(): void {
    for (const callback of this.webviewLoadCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  stopActiveWebTabTracking(): void {
    this.activeWebTabTrackingRefs = null;

    this.cleanupWebviewLoadListeners();

    this.cancelScheduledWebviewLoadNotify?.();
    this.cancelScheduledWebviewLoadNotify = null;

    this.activeWebTabState = {
      activeWebTabForMentions: null,
      activeOrLastWebTab: null,
    };
    this.activeWebTabLeaf = null;
    this.lastActiveLeaf = null;
    this.activeWebTabTrackingPreserveViewTypes = [];
  }

  private recomputeActiveWebTabState(params: RecomputeActiveWebTabStateParams): void {
    if (!this.isSupportedPlatform()) {
      this.setActiveWebTabState({ activeWebTabForMentions: null, activeOrLastWebTab: null });
      this.activeWebTabLeaf = null;
      return;
    }

    const activeWebLeaf = this.getActiveLeaf();

    if (params.trigger === "webview-metadata") {
      const loadedLeaf = params.loadedLeaf;
      const isRelevant = loadedLeaf === this.activeWebTabLeaf || loadedLeaf === activeWebLeaf;
      if (!isRelevant) {
        return;
      }
    }

    let nextActiveWebTabLeaf = this.activeWebTabLeaf;
    let nextActiveWebTabForMentions = this.activeWebTabState.activeWebTabForMentions;

    if (activeWebLeaf) {
      nextActiveWebTabLeaf = activeWebLeaf;
      nextActiveWebTabForMentions = this.toWebTabContext(activeWebLeaf);
    } else if (params.trigger === "active-leaf-change") {
      const viewType = params.activeLeaf?.view?.getViewType();
      const preserve = Boolean(
        viewType && this.activeWebTabTrackingPreserveViewTypes.includes(viewType)
      );
      if (!preserve) {
        nextActiveWebTabLeaf = null;
        nextActiveWebTabForMentions = null;
      }
    }

    if (params.trigger !== "webview-metadata" && nextActiveWebTabLeaf) {
      const leafStillOpen = this.getLeaves().includes(nextActiveWebTabLeaf);
      if (!leafStillOpen) {
        nextActiveWebTabLeaf = null;
        nextActiveWebTabForMentions = null;
      }
    }

    if (params.trigger === "layout-change") {
      if (nextActiveWebTabLeaf) {
        nextActiveWebTabForMentions = this.toWebTabContext(nextActiveWebTabLeaf);
      }
    } else if (params.trigger === "webview-metadata") {
      const loadedLeaf = params.loadedLeaf;
      nextActiveWebTabLeaf = loadedLeaf;
      nextActiveWebTabForMentions = this.toWebTabContext(loadedLeaf);
    }

    this.activeWebTabLeaf = nextActiveWebTabLeaf;

    const nextActiveOrLastWebTab = this.computeActiveOrLastWebTabContext();
    this.setActiveWebTabState({
      activeWebTabForMentions: nextActiveWebTabForMentions,
      activeOrLastWebTab: nextActiveOrLastWebTab,
    });
  }

  private computeActiveOrLastWebTabContext(): WebTabContext | null {
    try {
      const leaf = this.getActiveLeaf() ?? this.getLastActiveLeaf();
      if (!leaf) return null;
      return this.toWebTabContext(leaf);
    } catch {
      return null;
    }
  }

  private toWebTabContext(leaf: WebViewerLeaf): WebTabContext | null {
    try {
      const info = this.getPageInfo(leaf);
      const url = (info.url || "").trim();
      if (!url) return null;
      const title = (info.title || "").trim();
      const faviconUrl = (info.faviconUrl || "").trim();
      return {
        url,
        title: title ? title : undefined,
        faviconUrl: faviconUrl ? faviconUrl : undefined,
      };
    } catch {
      return null;
    }
  }

  private setActiveWebTabState(next: ActiveWebTabStateSnapshot): void {
    const prev = this.activeWebTabState;
    const unchanged =
      WebViewerStateManager.areWebTabContextsEqual(
        prev.activeWebTabForMentions,
        next.activeWebTabForMentions
      ) &&
      WebViewerStateManager.areWebTabContextsEqual(
        prev.activeOrLastWebTab,
        next.activeOrLastWebTab
      );

    if (unchanged) {
      return;
    }

    this.activeWebTabState = next;
    this.notifyActiveWebTabListeners();
  }

  private notifyActiveWebTabListeners(): void {
    for (const listener of this.activeWebTabListeners) {
      try {
        listener(this.activeWebTabState);
      } catch (err) {
        logWarn("[WebViewerStateManager] Error in Active Web Tab listener:", err);
      }
    }
  }

  private static areWebTabContextsEqual(a: WebTabContext | null, b: WebTabContext | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.url === b.url && a.title === b.title && a.faviconUrl === b.faviconUrl;
  }
}
