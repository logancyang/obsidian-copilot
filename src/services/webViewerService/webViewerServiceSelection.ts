/**
 * Web Viewer Service Selection Tracker
 *
 * Manages automatic web selection tracking for Web Viewer tabs.
 * Uses self-scheduling setTimeout pattern to avoid concurrent execution.
 */

import * as actions from "@/services/webViewerService/webViewerServiceActions";
import type { WebViewerLeaf } from "@/services/webViewerService/webViewerServiceTypes";
import type { WebSelectedTextContext } from "@/types/message";
import { v4 as uuidv4 } from "uuid";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for starting web selection tracking
 */
export interface WebSelectionTrackingOptions {
  /** Polling interval in milliseconds (default: 500) */
  intervalMs?: number;
  /** Consecutive empty selection checks required before clearing (default: 2) */
  emptySelectionDebounceCount?: number;
  /** Callback to check if tracking should be enabled */
  isEnabled: () => boolean;
  /** Callback to get the active or last active Web Viewer leaf */
  getLeaf: () => WebViewerLeaf | null;
  /** Callback to get the currently active Web Viewer leaf (if any) */
  getActiveLeaf: () => WebViewerLeaf | null;
  /** Callback when a new web selection is detected */
  onSelectionChange: (context: WebSelectedTextContext) => void;
  /** Callback when the current web selection should be cleared (badge removed) */
  onSelectionClear: (event: WebSelectionClearEvent) => void;
}

/**
 * Event payload for when a web selection should be cleared.
 */
export interface WebSelectionClearEvent {
  /** The URL whose selection badge should be cleared. */
  url: string;
  /** Why the selection is being cleared. */
  reason: WebSelectionClearReason;
}

/**
 * Reasons for requesting a web selection clear.
 */
export type WebSelectionClearReason = "selection-cleared" | "invalid-url";

/**
 * State for deduplication
 */
interface SelectionState {
  url: string;
  text: string;
}

/**
 * Per-leaf tracking state.
 */
interface LeafSelectionTrackingState {
  lastSelection: SelectionState | null;
  consecutiveEmptyChecks: number;
  consecutiveInvalidUrlChecks: number;
}

// ============================================================================
// WebSelectionTracker Class
// ============================================================================

/**
 * Tracks web selection changes in Web Viewer tabs.
 *
 * Features:
 * - Self-scheduling setTimeout pattern (no concurrent execution)
 * - Deduplication by url + text
 * - Lightweight text check before expensive markdown conversion
 * - Clears badge when selection is cleared (debounced, active-leaf gated)
 * - Clears badge on invalid/empty URL (best-effort, active-leaf gated)
 */
export class WebSelectionTracker {
  private readonly intervalMs: number;
  private readonly emptySelectionDebounceCount: number;
  private readonly isEnabled: () => boolean;
  private readonly getLeaf: () => WebViewerLeaf | null;
  private readonly getActiveLeaf: () => WebViewerLeaf | null;
  private readonly onSelectionChange: (context: WebSelectedTextContext) => void;
  private readonly onSelectionClear: (event: WebSelectionClearEvent) => void;

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private leafState = new WeakMap<WebViewerLeaf, LeafSelectionTrackingState>();
  /** URL-based suppression map: URL -> pinned selection text (null means "pin next observed") */
  private suppressedSelectionsByUrl = new Map<string, string | null>();

  constructor(options: WebSelectionTrackingOptions) {
    this.intervalMs = options.intervalMs ?? 500;

    const configuredEmptyCount = options.emptySelectionDebounceCount ?? 2;
    this.emptySelectionDebounceCount =
      Number.isFinite(configuredEmptyCount) && configuredEmptyCount > 0
        ? Math.floor(configuredEmptyCount)
        : 2;

    this.isEnabled = options.isEnabled;
    this.getLeaf = options.getLeaf;
    this.getActiveLeaf = options.getActiveLeaf;
    this.onSelectionChange = options.onSelectionChange;
    this.onSelectionClear = options.onSelectionClear;
  }

  /**
   * Start tracking web selection changes.
   * Idempotent - calling multiple times is safe.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
  }

  /**
   * Stop tracking web selection changes.
   * Clears any pending timeout and resets state.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.leafState = new WeakMap<WebViewerLeaf, LeafSelectionTrackingState>();
    this.suppressedSelectionsByUrl = new Map<string, string | null>();
  }

  /**
   * Schedule the next check using setTimeout.
   * Uses self-scheduling pattern to ensure no concurrent execution.
   */
  private scheduleNext(): void {
    if (!this.isRunning) return;

    this.timeoutId = setTimeout(async () => {
      await this.checkSelection();
      // Schedule next only after current check completes
      this.scheduleNext();
    }, this.intervalMs);
  }

  /**
   * Check for selection changes in the active Web Viewer tab.
   */
  private async checkSelection(): Promise<void> {
    // Skip if tracking is disabled
    if (!this.isEnabled()) {
      return;
    }

    try {
      const leaf = this.getLeaf();
      if (!leaf) return;

      const state = this.getOrCreateLeafState(leaf);

      // Get page URL for deduplication
      const pageInfo = actions.getPageInfo(leaf);
      const url = pageInfo.url;

      if (this.isValidUrl(url)) {
        state.consecutiveInvalidUrlChecks = 0;
      } else {
        // URL is empty/invalid page: debounce and clear (best-effort)
        state.consecutiveEmptyChecks = 0;
        this.maybeClearSelectionForInvalidUrl(leaf, state);
        return;
      }

      // Use lightweight getSelectedText first to check for changes
      const selectedText = await actions.getSelectedText(leaf);

      // Empty selection: debounce and clear (only when leaf is active)
      if (!selectedText.trim()) {
        this.handleEmptySelection(leaf, state);
        return;
      }

      // Non-empty selection observed -> reset empty debounce for this leaf
      state.consecutiveEmptyChecks = 0;

      // URL-based suppression: after user removes web selection (or starts a new chat),
      // don't auto-capture the same selection until it changes or is cleared.
      if (this.shouldSuppressSelectionForUrl(url, selectedText)) {
        return;
      }

      // Deduplication: check if url + text combo has changed
      // This handles the case of same text on different pages
      if (
        state.lastSelection &&
        state.lastSelection.url === url &&
        state.lastSelection.text === selectedText
      ) {
        return;
      }

      // Get full markdown content (more expensive)
      const selectedMarkdown = await actions.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        return;
      }

      // Race guard: user may click X / start a new chat while getSelectedMarkdown() is in progress.
      // If suppression became active mid-flight, do not emit.
      if (this.shouldSuppressSelectionForUrl(url, selectedText)) {
        return;
      }

      // Update deduplication state (only after markdown is confirmed non-empty)
      state.lastSelection = { url, text: selectedText };

      // Create web selection context
      const context: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url,
        faviconUrl: pageInfo.faviconUrl || undefined,
      };

      // Notify callback
      this.onSelectionChange(context);
    } catch {
      // Ignore errors - web viewer may not be available
    }
  }

  /**
   * Get or initialize tracking state for a leaf.
   */
  private getOrCreateLeafState(leaf: WebViewerLeaf): LeafSelectionTrackingState {
    const existing = this.leafState.get(leaf);
    if (existing) {
      return existing;
    }

    const initial: LeafSelectionTrackingState = {
      lastSelection: null,
      consecutiveEmptyChecks: 0,
      consecutiveInvalidUrlChecks: 0,
    };

    this.leafState.set(leaf, initial);
    return initial;
  }

  /**
   * Returns true when `url` is a non-empty absolute URL string.
   */
  private isValidUrl(url: string): boolean {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the given leaf is the currently active Web Viewer leaf.
   */
  private isActiveWebViewerLeaf(leaf: WebViewerLeaf): boolean {
    const activeLeaf = this.getActiveLeaf();
    return Boolean(activeLeaf && activeLeaf === leaf);
  }

  /**
   * Handle the "non-empty -> empty" transition with debounce and active-leaf gating.
   */
  private handleEmptySelection(leaf: WebViewerLeaf, state: LeafSelectionTrackingState): void {
    // Only clear when we previously observed a non-empty selection for this leaf
    if (!state.lastSelection) {
      return;
    }

    // Only clear when the Web Viewer leaf is currently active (user is on that page)
    if (!this.isActiveWebViewerLeaf(leaf)) {
      return;
    }

    state.consecutiveEmptyChecks += 1;
    if (state.consecutiveEmptyChecks < this.emptySelectionDebounceCount) {
      return;
    }

    const urlToClear = state.lastSelection.url;

    // Reset state when selection is truly cleared
    state.lastSelection = null;
    state.consecutiveEmptyChecks = 0;
    // Clear suppression for the URL that was actually selected (not current page URL)
    this.clearSuppressionForUrl(urlToClear);

    this.onSelectionClear({ url: urlToClear, reason: "selection-cleared" });
  }

  /**
   * Clear selection badge when current page URL is empty/invalid (best-effort, debounced).
   */
  private maybeClearSelectionForInvalidUrl(
    leaf: WebViewerLeaf,
    state: LeafSelectionTrackingState
  ): void {
    // Only clear when we previously observed a valid selection for this leaf
    if (!state.lastSelection) {
      return;
    }

    // Only clear when the Web Viewer leaf is currently active (user is on that page)
    if (!this.isActiveWebViewerLeaf(leaf)) {
      return;
    }

    // Debounce: require consecutive invalid URL checks before clearing
    state.consecutiveInvalidUrlChecks += 1;
    if (state.consecutiveInvalidUrlChecks < this.emptySelectionDebounceCount) {
      return;
    }

    const urlToClear = state.lastSelection.url;

    // Reset state since page is invalid and selection is no longer meaningful
    state.lastSelection = null;
    state.consecutiveEmptyChecks = 0;
    state.consecutiveInvalidUrlChecks = 0;
    this.clearSuppressionForUrl(urlToClear);

    this.onSelectionClear({ url: urlToClear, reason: "invalid-url" });
  }

  /**
   * Clear suppression state for the given URL.
   * @param url - The URL whose suppression state should be cleared
   */
  private clearSuppressionForUrl(url: string): void {
    this.suppressedSelectionsByUrl.delete(url.trim());
  }

  /**
   * Returns true if the current selection should be suppressed for the given URL.
   * When suppression is first activated for a URL, the next observed non-empty selection
   * is pinned and suppressed.
   * @param url - Current page URL
   * @param selectedText - Current non-empty selection text
   * @returns True if the selection should be suppressed
   */
  private shouldSuppressSelectionForUrl(url: string, selectedText: string): boolean {
    const urlKey = url.trim();
    const suppressedText = this.suppressedSelectionsByUrl.get(urlKey);
    if (suppressedText === undefined) {
      return false;
    }

    if (suppressedText === null) {
      // Pin the current selection as the one to suppress
      this.suppressedSelectionsByUrl.set(urlKey, selectedText);
      return true;
    }

    if (suppressedText === selectedText) {
      return true;
    }

    // Selection changed -> lift suppression and proceed with normal capture
    this.suppressedSelectionsByUrl.delete(urlKey);
    return false;
  }

  /**
   * Suppress auto-capture for the given URL so the selection won't be re-added until it changes or is cleared.
   * The selection text is pinned on the next observed non-empty selection for that URL.
   * @param url - The URL whose selection should be suppressed
   */
  suppressSelectionForUrl(url: string): void {
    const trimmed = url.trim();
    if (!this.isValidUrl(trimmed)) {
      return;
    }

    this.suppressedSelectionsByUrl.set(trimmed, null);
  }

  /**
   * Suppress the current web selection from being auto-captured again until it changes or is cleared.
   * Use this for:
   * - User removes web selection context (badge X)
   * - New chat (prevent previous web selection from reappearing)
   */
  suppressCurrentSelection(): void {
    const leaf = this.getLeaf();
    if (!leaf) return;

    const pageInfo = actions.getPageInfo(leaf);
    this.suppressSelectionForUrl(pageInfo.url);
  }
}
