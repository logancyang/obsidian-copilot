import * as actions from "@/services/webViewerService/webViewerServiceActions";
import type { WebViewerLeaf } from "@/services/webViewerService/webViewerServiceTypes";
import type { WebSelectedTextContext } from "@/types/message";
import { v4 as uuidv4 } from "uuid";

export interface WebSelectionTrackingOptions {
  intervalMs?: number;
  emptySelectionDebounceCount?: number;
  isEnabled: () => boolean;
  getLeaf: () => WebViewerLeaf | null;
  getActiveLeaf: () => WebViewerLeaf | null;
  onSelectionChange: (context: WebSelectedTextContext) => void;
  onSelectionClear: (event: WebSelectionClearEvent) => void;
}

export interface WebSelectionClearEvent {
  url: string;
  reason: WebSelectionClearReason;
}

export type WebSelectionClearReason = "selection-cleared" | "invalid-url";

interface SelectionState {
  url: string;
  text: string;
}

interface LeafSelectionTrackingState {
  lastSelection: SelectionState | null;
  consecutiveEmptyChecks: number;
  consecutiveInvalidUrlChecks: number;
}

export class WebSelectionTracker {
  private readonly intervalMs: number;
  private readonly emptySelectionDebounceCount: number;
  private readonly isEnabled: () => boolean;
  private readonly getLeaf: () => WebViewerLeaf | null;
  private readonly getActiveLeaf: () => WebViewerLeaf | null;
  private readonly onSelectionChange: (context: WebSelectedTextContext) => void;
  private readonly onSelectionClear: (event: WebSelectionClearEvent) => void;

  private timeoutId: number | null = null;
  private isRunning = false;
  private leafState = new WeakMap<WebViewerLeaf, LeafSelectionTrackingState>();
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

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.leafState = new WeakMap<WebViewerLeaf, LeafSelectionTrackingState>();
    this.suppressedSelectionsByUrl = new Map<string, string | null>();
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;

    this.timeoutId = window.setTimeout(() => {
      void (async () => {
        await this.checkSelection();
        this.scheduleNext();
      })();
    }, this.intervalMs);
  }

  private async checkSelection(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      const leaf = this.getLeaf();
      if (!leaf) return;

      const state = this.getOrCreateLeafState(leaf);

      const pageInfo = actions.getPageInfo(leaf);
      const url = pageInfo.url;

      if (this.isValidUrl(url)) {
        state.consecutiveInvalidUrlChecks = 0;
      } else {
        state.consecutiveEmptyChecks = 0;
        this.maybeClearSelectionForInvalidUrl(leaf, state);
        return;
      }

      const selectedText = await actions.getSelectedText(leaf);

      if (!selectedText.trim()) {
        this.handleEmptySelection(leaf, state);
        return;
      }

      state.consecutiveEmptyChecks = 0;

      if (this.shouldSuppressSelectionForUrl(url, selectedText)) {
        return;
      }

      if (
        state.lastSelection &&
        state.lastSelection.url === url &&
        state.lastSelection.text === selectedText
      ) {
        return;
      }

      const selectedMarkdown = await actions.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        return;
      }

      if (this.shouldSuppressSelectionForUrl(url, selectedText)) {
        return;
      }

      state.lastSelection = { url, text: selectedText };

      const context: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url,
        faviconUrl: pageInfo.faviconUrl || undefined,
      };

      this.onSelectionChange(context);
    } catch {
      return;
    }
  }

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

  private isActiveWebViewerLeaf(leaf: WebViewerLeaf): boolean {
    const activeLeaf = this.getActiveLeaf();
    return Boolean(activeLeaf && activeLeaf === leaf);
  }

  private handleEmptySelection(leaf: WebViewerLeaf, state: LeafSelectionTrackingState): void {
    if (!state.lastSelection) {
      return;
    }

    if (!this.isActiveWebViewerLeaf(leaf)) {
      return;
    }

    state.consecutiveEmptyChecks += 1;
    if (state.consecutiveEmptyChecks < this.emptySelectionDebounceCount) {
      return;
    }

    const urlToClear = state.lastSelection.url;

    state.lastSelection = null;
    state.consecutiveEmptyChecks = 0;
    this.clearSuppressionForUrl(urlToClear);

    this.onSelectionClear({ url: urlToClear, reason: "selection-cleared" });
  }

  private maybeClearSelectionForInvalidUrl(
    leaf: WebViewerLeaf,
    state: LeafSelectionTrackingState
  ): void {
    if (!state.lastSelection) {
      return;
    }

    if (!this.isActiveWebViewerLeaf(leaf)) {
      return;
    }

    state.consecutiveInvalidUrlChecks += 1;
    if (state.consecutiveInvalidUrlChecks < this.emptySelectionDebounceCount) {
      return;
    }

    const urlToClear = state.lastSelection.url;

    state.lastSelection = null;
    state.consecutiveEmptyChecks = 0;
    state.consecutiveInvalidUrlChecks = 0;
    this.clearSuppressionForUrl(urlToClear);

    this.onSelectionClear({ url: urlToClear, reason: "invalid-url" });
  }

  private clearSuppressionForUrl(url: string): void {
    this.suppressedSelectionsByUrl.delete(url.trim());
  }

  private shouldSuppressSelectionForUrl(url: string, selectedText: string): boolean {
    const urlKey = url.trim();
    const suppressedText = this.suppressedSelectionsByUrl.get(urlKey);
    if (suppressedText === undefined) {
      return false;
    }

    if (suppressedText === null) {
      this.suppressedSelectionsByUrl.set(urlKey, selectedText);
      return true;
    }

    if (suppressedText === selectedText) {
      return true;
    }

    this.suppressedSelectionsByUrl.delete(urlKey);
    return false;
  }

  suppressSelectionForUrl(url: string): void {
    const trimmed = url.trim();
    if (!this.isValidUrl(trimmed)) {
      return;
    }

    this.suppressedSelectionsByUrl.set(trimmed, null);
  }

  suppressCurrentSelection(): void {
    const leaf = this.getLeaf();
    if (!leaf) return;

    const pageInfo = actions.getPageInfo(leaf);
    this.suppressSelectionForUrl(pageInfo.url);
  }
}
