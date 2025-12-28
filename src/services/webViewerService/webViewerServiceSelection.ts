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
  /** Callback to check if tracking should be enabled */
  isEnabled: () => boolean;
  /** Callback to get the active or last active Web Viewer leaf */
  getLeaf: () => WebViewerLeaf | null;
  /** Callback when a new web selection is detected */
  onSelectionChange: (context: WebSelectedTextContext) => void;
}

/**
 * State for deduplication
 */
interface SelectionState {
  url: string;
  text: string;
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
 */
export class WebSelectionTracker {
  private readonly intervalMs: number;
  private readonly isEnabled: () => boolean;
  private readonly getLeaf: () => WebViewerLeaf | null;
  private readonly onSelectionChange: (context: WebSelectedTextContext) => void;

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private lastSelection: SelectionState | null = null;

  constructor(options: WebSelectionTrackingOptions) {
    this.intervalMs = options.intervalMs ?? 500;
    this.isEnabled = options.isEnabled;
    this.getLeaf = options.getLeaf;
    this.onSelectionChange = options.onSelectionChange;
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
    this.lastSelection = null;
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

      // Get page URL for deduplication
      const pageInfo = actions.getPageInfo(leaf);
      const url = pageInfo.url;
      if (!url) return;

      // Use lightweight getSelectedText first to check for changes
      const selectedText = await actions.getSelectedText(leaf);

      // Skip if empty
      if (!selectedText.trim()) {
        this.lastSelection = null;
        return;
      }

      // Deduplication: check if url + text combo has changed
      // This handles the case of same text on different pages
      if (
        this.lastSelection &&
        this.lastSelection.url === url &&
        this.lastSelection.text === selectedText
      ) {
        return;
      }

      // Update deduplication state
      this.lastSelection = { url, text: selectedText };

      // Get full markdown content (more expensive)
      const selectedMarkdown = await actions.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        return;
      }

      // Create web selection context
      const context: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url,
      };

      // Notify callback
      this.onSelectionChange(context);
    } catch {
      // Ignore errors - web viewer may not be available
    }
  }

  /**
   * Clear the deduplication state.
   * Call this when the user manually clears selection context.
   */
  clearDeduplicationState(): void {
    this.lastSelection = null;
  }
}
