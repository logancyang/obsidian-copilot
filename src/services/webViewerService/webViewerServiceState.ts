/**
 * Web Viewer Service State Manager
 *
 * Manages Active Web Tab state (single source of truth) and leaf tracking.
 * Extracted from WebViewerService to reduce file size.
 */

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

// ============================================================================
// Webview Event Types
// ============================================================================

/** Webview events that can trigger Web Viewer tab metadata refresh. */
const WEBVIEW_METADATA_EVENTS = [
  "did-finish-load",
  "page-favicon-updated",
  "page-title-updated",
] as const;

/** Union type of supported webview metadata event names. */
type WebviewMetadataEventName = (typeof WEBVIEW_METADATA_EVENTS)[number];

/** Entry for tracking webview event listeners. */
interface WebviewLoadListenerEntry {
  leaf: WebViewerLeaf;
  handler: () => void;
  events: ReadonlyArray<WebviewMetadataEventName>;
}

// ============================================================================
// Recompute Active Web Tab State Parameters
// ============================================================================

/**
 * Parameters for the unified recomputeActiveWebTabState method.
 * Discriminated union based on trigger type.
 */
type RecomputeActiveWebTabStateParams =
  | { trigger: "active-leaf-change"; activeLeaf: WorkspaceLeaf | null }
  | { trigger: "layout-change" }
  | { trigger: "webview-metadata"; loadedLeaf: WebViewerLeaf };

// ============================================================================
// Dependencies Interface
// ============================================================================

/**
 * Dependencies injected into WebViewerStateManager.
 * Avoids circular dependency with WebViewerService.
 */
export interface WebViewerStateManagerDeps {
  app: App;
  isSupportedPlatform: () => boolean;
  getActiveLeaf: () => WebViewerLeaf | null;
  getLeaves: () => WebViewerLeaf[];
  getPageInfo: (leaf: WebViewerLeaf) => WebViewerPageInfo;
}

// ============================================================================
// WebViewerStateManager Class
// ============================================================================

/**
 * Manages Active Web Tab state and leaf tracking for WebViewerService.
 */
export class WebViewerStateManager {
  private readonly app: App;
  private readonly isSupportedPlatform: () => boolean;
  private readonly getActiveLeaf: () => WebViewerLeaf | null;
  private readonly getLeaves: () => WebViewerLeaf[];
  private readonly getPageInfo: (leaf: WebViewerLeaf) => WebViewerPageInfo;

  // Leaf tracking
  private lastActiveLeaf: WebViewerLeaf | null = null;

  // Active Web Tab state (Single Source of Truth)
  private activeWebTabState: ActiveWebTabStateSnapshot = {
    activeWebTabForMentions: null,
    activeOrLastWebTab: null,
  };
  // Track the leaf corresponding to activeWebTabForMentions for identity matching
  private activeWebTabLeaf: WebViewerLeaf | null = null;
  private activeWebTabListeners: Set<ActiveWebTabStateListener> = new Set();
  private activeWebTabTrackingRefs: ActiveWebTabTrackingRefs | null = null;
  private activeWebTabTrackingPreserveViewTypes: string[] = [];
  // Track webview event listeners for cleanup (Map for incremental updates)
  private webviewLoadListeners: Map<HTMLElement, WebviewLoadListenerEntry> = new Map();
  // Callbacks to notify when any webview finishes loading
  private webviewLoadCallbacks: Set<() => void> = new Set();
  // Cancel handle for a scheduled webview load callback notification tick
  private cancelScheduledWebviewLoadNotify: (() => void) | null = null;

  constructor(deps: WebViewerStateManagerDeps) {
    this.app = deps.app;
    this.isSupportedPlatform = deps.isSupportedPlatform;
    this.getActiveLeaf = deps.getActiveLeaf;
    this.getLeaves = deps.getLeaves;
    this.getPageInfo = deps.getPageInfo;
  }

  // --------------------------------------------------------------------------
  // Leaf Tracking
  // --------------------------------------------------------------------------

  /**
   * Get the most recently active Web Viewer leaf tracked by this manager.
   */
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

  /**
   * Find a Web Viewer leaf by URL (best-effort normalized match).
   * @param url - The URL to search for
   * @param options - Optional disambiguation hints
   * @param options.title - Page title hint to help disambiguate multiple URL matches
   */
  findLeafByUrl(url: string, options: { title?: string } = {}): WebViewerLeaf | null {
    const targetRaw = url.trim();
    if (!targetRaw) return null;

    const leaves = this.getLeaves();

    // Fast path: exact match
    for (const leaf of leaves) {
      if (leaf?.view?.url === targetRaw) return leaf;
    }

    // Slow path: normalized match
    const targetNormalized = normalizeUrlForMatching(targetRaw);
    if (!targetNormalized) return null;

    // Collect all leaves that match after normalization
    const matchedLeaves: WebViewerLeaf[] = [];
    for (const leaf of leaves) {
      const leafUrl = leaf?.view?.url;
      if (!leafUrl) continue;

      const leafNormalized = normalizeUrlForMatching(leafUrl);
      if (leafNormalized === targetNormalized) {
        matchedLeaves.push(leaf);
      }
    }

    // No matches
    if (matchedLeaves.length === 0) {
      return null;
    }

    // Single match - safe to return
    if (matchedLeaves.length === 1) {
      return matchedLeaves[0];
    }

    // Multiple matches - try to disambiguate using title hint (if provided)
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

      // If title narrowed it down but still multiple, prefer active/lastActive among title matches
      if (titleMatchedLeaves.length > 1) {
        const activeLeaf = this.getActiveLeaf();
        if (activeLeaf && titleMatchedLeaves.includes(activeLeaf)) {
          return activeLeaf;
        }

        const lastActiveLeaf = this.getLastActiveLeaf();
        if (lastActiveLeaf && titleMatchedLeaves.includes(lastActiveLeaf)) {
          return lastActiveLeaf;
        }

        // Return first title match as fallback
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

    // Multiple matches - try to disambiguate using active/lastActive
    // This handles cases like two tabs differing only by hash
    const activeLeaf = this.getActiveLeaf();
    if (activeLeaf && matchedLeaves.includes(activeLeaf)) {
      return activeLeaf;
    }

    const lastActiveLeaf = this.getLastActiveLeaf();
    if (lastActiveLeaf && matchedLeaves.includes(lastActiveLeaf)) {
      return lastActiveLeaf;
    }

    // Cannot disambiguate further - return first match as deterministic fallback
    logWarn(
      "[WebViewerStateManager] Multiple leaves matched URL; returning first match as fallback.",
      {
        url: targetRaw,
        matches: matchedLeaves.length,
      }
    );
    return matchedLeaves[0];
  }

  // --------------------------------------------------------------------------
  // Active Web Tab State (Single Source of Truth)
  // --------------------------------------------------------------------------

  /**
   * Get the current Active Web Tab state snapshot.
   */
  getActiveWebTabState(): ActiveWebTabStateSnapshot {
    return this.activeWebTabState;
  }

  /**
   * Subscribe to Active Web Tab state updates.
   * @returns Unsubscribe function
   */
  subscribeActiveWebTabState(listener: ActiveWebTabStateListener): () => void {
    this.activeWebTabListeners.add(listener);
    return () => {
      this.activeWebTabListeners.delete(listener);
    };
  }

  /**
   * Subscribe to webview load events.
   * Called when any Web Viewer tab finishes loading (did-finish-load event).
   * Useful for refreshing tab metadata (title, favicon, etc.) after page load.
   * @returns Unsubscribe function
   */
  subscribeToWebviewLoad(callback: () => void): () => void {
    this.webviewLoadCallbacks.add(callback);
    return () => {
      this.webviewLoadCallbacks.delete(callback);
    };
  }

  /**
   * Start tracking Active Web Tab state using workspace events.
   * Call this in plugin onload() and register the returned EventRefs.
   */
  startActiveWebTabTracking(
    options: StartActiveWebTabTrackingOptions = {}
  ): ActiveWebTabTrackingRefs {
    // If already tracking, stop first to allow re-initialization with new options
    if (this.activeWebTabTrackingRefs) {
      this.stopActiveWebTabTracking();
    }

    this.activeWebTabTrackingPreserveViewTypes = [...(options.preserveOnViewTypes ?? [])];

    const activeLeafRef = this.app.workspace.on(
      "active-leaf-change",
      (leaf: WorkspaceLeaf | null) => {
        // Also update lastActiveLeaf for backward compatibility
        try {
          if (isWebViewerLeaf(leaf)) this.lastActiveLeaf = leaf;
        } catch (err) {
          logWarn("WebViewerStateManager failed to track active leaf:", err);
        }

        this.recomputeActiveWebTabState({ trigger: "active-leaf-change", activeLeaf: leaf });
        // Re-subscribe to webview events when active leaf changes
        this.subscribeToWebviewLoadEvents();
      }
    );

    const layoutRef = this.app.workspace.on("layout-change", () => {
      this.recomputeActiveWebTabState({ trigger: "layout-change" });
      // Re-subscribe to webview events when layout changes (new tabs may have been added)
      this.subscribeToWebviewLoadEvents();
    });

    this.activeWebTabTrackingRefs = { activeLeafRef, layoutRef };

    // Initialize snapshot eagerly
    this.recomputeActiveWebTabState({
      trigger: "active-leaf-change",
      activeLeaf: this.app.workspace.activeLeaf ?? null,
    });
    // Initial subscription to webview events
    this.subscribeToWebviewLoadEvents();

    return this.activeWebTabTrackingRefs;
  }

  /**
   * Sync webview event listeners for all Web Viewer leaves.
   * Listens to:
   * - did-finish-load: page finished loading (title available)
   * - page-favicon-updated: favicon has been resolved (may come after did-finish-load)
   *
   * Design:
   * - Incremental add/remove to avoid full unbind/rebind on frequent workspace events.
   * - Coalesces notifications to subscribers to avoid event storms.
   */
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
            // Already listening for this webview/leaf pair
            continue;
          }

          // If we already have a listener for this webview, remove it (leaf/view may have changed)
          if (existing) {
            for (const event of existing.events) {
              webview.removeEventListener(event, existing.handler);
            }
            this.webviewLoadListeners.delete(webview);
          }

          // Capture the leaf in closure so we know which leaf triggered the event
          const handler = () => {
            // When webview finishes loading or favicon updates, refresh state
            this.recomputeActiveWebTabState({ trigger: "webview-metadata", loadedLeaf: leaf });
            // Coalesce subscriber notifications to avoid event storms
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

      // Remove listeners for webviews that no longer exist
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

  /**
   * Clean up all webview event listeners safely.
   */
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

  /**
   * Schedule a single notification for webview load callbacks.
   * Coalesces rapid-fire webview events (e.g. repeated favicon updates) into one tick.
   */
  private scheduleWebviewLoadCallbackNotification(): void {
    if (this.cancelScheduledWebviewLoadNotify) {
      // Already scheduled, skip
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

  /**
   * Notify all webview load callbacks.
   */
  private notifyWebviewLoadCallbacks(): void {
    for (const callback of this.webviewLoadCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Stop tracking Active Web Tab state and clean up internal resources.
   * Call this in plugin onunload() if needed.
   *
   * Note: This method does NOT call offref() on workspace event refs because
   * they are registered via plugin.registerEvent() which handles cleanup automatically.
   * This method only cleans up webview DOM listeners and resets internal state.
   */
  stopActiveWebTabTracking(): void {
    // Clear refs reference (but don't offref - handled by plugin.registerEvent)
    this.activeWebTabTrackingRefs = null;

    // Clean up webview event listeners
    this.cleanupWebviewLoadListeners();

    // Cancel any scheduled notification
    this.cancelScheduledWebviewLoadNotify?.();
    this.cancelScheduledWebviewLoadNotify = null;

    // Reset state and leaf references
    this.activeWebTabState = {
      activeWebTabForMentions: null,
      activeOrLastWebTab: null,
    };
    this.activeWebTabLeaf = null;
    this.lastActiveLeaf = null;
    this.activeWebTabTrackingPreserveViewTypes = [];
  }

  /**
   * Unified entry point for recomputing Active Web Tab state.
   *
   * Rules:
   * - If a Web Viewer leaf is active, it always becomes `activeWebTabLeaf` and drives `activeWebTabForMentions`.
   * - Sticky semantics: only on `active-leaf-change` do we apply `preserveOnViewTypes` ("preserve" = do not clear; never restore).
   * - Layout changes validate the tracked leaf is still open and refresh its snapshot (URL/title/favicon may change).
   * - Webview metadata events refresh title/favicon via leaf identity matching (`activeWebTabLeaf`).
   */
  private recomputeActiveWebTabState(params: RecomputeActiveWebTabStateParams): void {
    if (!this.isSupportedPlatform()) {
      this.setActiveWebTabState({ activeWebTabForMentions: null, activeOrLastWebTab: null });
      this.activeWebTabLeaf = null;
      return;
    }

    const activeWebLeaf = this.getActiveLeaf();

    // Fast-path for webview-metadata: only process if the loaded leaf is relevant.
    // This matches the old refreshActiveWebTabStateForLeaf behavior and avoids
    // unnecessary recomputation when background tabs trigger favicon/load events.
    // We check both activeWebTabLeaf (tracked) and activeWebLeaf (current) because:
    // - activeWebTabLeaf: the leaf we're tracking for mentions
    // - activeWebLeaf: handles the case where user just switched to a WebViewer tab
    //   but activeWebTabLeaf hasn't been updated yet (e.g., was previously cleared)
    if (params.trigger === "webview-metadata") {
      const loadedLeaf = params.loadedLeaf;
      const isRelevant = loadedLeaf === this.activeWebTabLeaf || loadedLeaf === activeWebLeaf;
      if (!isRelevant) {
        return;
      }
    }

    let nextActiveWebTabLeaf = this.activeWebTabLeaf;
    let nextActiveWebTabForMentions = this.activeWebTabState.activeWebTabForMentions;

    // 1) Active Web Viewer leaf always wins.
    if (activeWebLeaf) {
      nextActiveWebTabLeaf = activeWebLeaf;
      nextActiveWebTabForMentions = this.toWebTabContext(activeWebLeaf);
    } else if (params.trigger === "active-leaf-change") {
      // 2) Sticky semantics only applies to active-leaf-change.
      const viewType = params.activeLeaf?.view?.getViewType();
      const preserve = Boolean(
        viewType && this.activeWebTabTrackingPreserveViewTypes.includes(viewType)
      );
      if (!preserve) {
        nextActiveWebTabLeaf = null;
        nextActiveWebTabForMentions = null;
      }
    }

    // 3) Validate tracked leaf is still open (identity-based).
    // Only for active-leaf-change and layout-change triggers.
    // For webview-metadata, we already validated relevance above.
    if (params.trigger !== "webview-metadata" && nextActiveWebTabLeaf) {
      const leafStillOpen = this.getLeaves().includes(nextActiveWebTabLeaf);
      if (!leafStillOpen) {
        nextActiveWebTabLeaf = null;
        nextActiveWebTabForMentions = null;
      }
    }

    // 4) Metadata refresh hooks.
    if (params.trigger === "layout-change") {
      if (nextActiveWebTabLeaf) {
        nextActiveWebTabForMentions = this.toWebTabContext(nextActiveWebTabLeaf);
      }
    } else if (params.trigger === "webview-metadata") {
      const loadedLeaf = params.loadedLeaf;
      // At this point, loadedLeaf is guaranteed to be relevant (checked in fast-path above).
      // Refresh the snapshot with fresh metadata.
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

  /**
   * Compute the best-effort active-or-last Web Tab context for UI display.
   */
  private computeActiveOrLastWebTabContext(): WebTabContext | null {
    try {
      const leaf = this.getActiveLeaf() ?? this.getLastActiveLeaf();
      if (!leaf) return null;
      return this.toWebTabContext(leaf);
    } catch {
      return null;
    }
  }

  /**
   * Convert a Web Viewer leaf into a serializable WebTabContext snapshot.
   */
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

  /**
   * Update internal snapshot and notify listeners when it changes.
   */
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

  /**
   * Notify Active Web Tab subscribers of a state update.
   */
  private notifyActiveWebTabListeners(): void {
    for (const listener of this.activeWebTabListeners) {
      try {
        listener(this.activeWebTabState);
      } catch (err) {
        logWarn("[WebViewerStateManager] Error in Active Web Tab listener:", err);
      }
    }
  }

  /**
   * Compare two WebTabContext objects for equality.
   */
  private static areWebTabContextsEqual(a: WebTabContext | null, b: WebTabContext | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.url === b.url && a.title === b.title && a.faviconUrl === b.faviconUrl;
  }
}
