/**
 * Web Viewer Service - Obsidian Web Viewer API wrapper
 *
 * Thin orchestration layer delegating leaf/webview operations to webViewerServiceActions.ts.
 * State management is delegated to WebViewerStateManager.
 * Note: Web Viewer is an internal API surface that may change without notice.
 * Desktop-only (depends on Electron webview).
 */

import type { App } from "obsidian";
import { Platform } from "obsidian";

import { logError, logWarn } from "@/logger";
import * as actions from "@/services/webViewerService/webViewerServiceActions";
import {
  getCommandManager,
  getInternalWebViewerPluginApi,
  isCommandRegistered,
  toErrorMessage,
  waitFor,
} from "@/services/webViewerService/webViewerServiceHelpers";
import { WebViewerStateManager } from "@/services/webViewerService/webViewerServiceState";
import {
  type ActiveWebTabStateListener,
  type ActiveWebTabStateSnapshot,
  type ActiveWebTabTrackingRefs,
  isWebViewerLeaf,
  type ResolveLeafOptions,
  type SaveToVaultResult,
  type StartActiveWebTabTrackingOptions,
  WEB_VIEWER_COMMANDS,
  WEB_VIEWER_VIEW_TYPE,
  type WebViewerAvailability,
  type WebViewerCommandId,
  WebViewerError,
  type WebViewerLeaf,
  WebViewerLeafNotFoundError,
  type WebViewerPageInfo,
  type WebViewerPluginApi,
  WebViewerUnsupportedError,
} from "@/services/webViewerService/webViewerServiceTypes";

// ============================================================================
// WebViewerService Class
// ============================================================================

/**
 * Service that encapsulates all Web Viewer API operations.
 */
export class WebViewerService {
  private readonly app: App;
  private internalPluginApi: WebViewerPluginApi | null = null;

  // State manager handles Active Web Tab state and leaf tracking
  private readonly stateManager: WebViewerStateManager;

  constructor(app: App) {
    this.app = app;

    // Initialize state manager with dependency injection
    this.stateManager = new WebViewerStateManager({
      app,
      isSupportedPlatform: () => this.isSupportedPlatform(),
      getActiveLeaf: () => this.getActiveLeaf(),
      getLeaves: () => this.getLeaves(),
      getPageInfo: (leaf) => actions.getPageInfo(leaf),
    });
  }

  // --------------------------------------------------------------------------
  // Platform & Availability
  // --------------------------------------------------------------------------

  /** Check if the current platform supports Web Viewer (desktop only). */
  isSupportedPlatform(): boolean {
    return Platform.isDesktopApp === true;
  }

  /** Get detailed Web Viewer availability information. */
  getAvailability(): WebViewerAvailability {
    const platform: WebViewerAvailability["platform"] = this.isSupportedPlatform()
      ? "desktop"
      : "mobile";

    if (!this.isSupportedPlatform()) {
      return {
        supported: false,
        available: false,
        platform,
        reason: "Web Viewer is not supported on mobile platforms.",
      };
    }

    const leaves = this.getLeaves();
    if (leaves.length > 0) {
      return { supported: true, available: true, platform };
    }

    const api = this.getInternalPluginApi();
    if (api) {
      return { supported: true, available: true, platform };
    }

    const hasWebViewerCommands = isCommandRegistered(this.app, WEB_VIEWER_COMMANDS.OPEN);
    if (hasWebViewerCommands) {
      return {
        supported: true,
        available: true,
        platform,
        reason: "No Web Viewer leaves open, but Web Viewer commands are registered.",
      };
    }

    return {
      supported: true,
      available: false,
      platform,
      reason: "Web Viewer does not appear available.",
    };
  }

  /** Throw if Web Viewer is not available. */
  assertAvailable(): void {
    const availability = this.getAvailability();
    if (!availability.supported) {
      throw new WebViewerUnsupportedError(availability.reason ?? "Web Viewer unsupported.");
    }
    if (!availability.available) {
      throw new WebViewerError(availability.reason ?? "Web Viewer is not available.");
    }
  }

  // --------------------------------------------------------------------------
  // Leaf Management
  // --------------------------------------------------------------------------

  /** Get all currently open Web Viewer leaves. */
  getLeaves(): WebViewerLeaf[] {
    if (!this.isSupportedPlatform()) return [];
    return this.app.workspace.getLeavesOfType(WEB_VIEWER_VIEW_TYPE) as WebViewerLeaf[];
  }

  /** Get the currently active Web Viewer leaf (if any). */
  getActiveLeaf(): WebViewerLeaf | null {
    const leaf = this.app.workspace.activeLeaf;
    return isWebViewerLeaf(leaf) ? leaf : null;
  }

  /** Get the most recently active Web Viewer leaf tracked by this service. */
  getLastActiveLeaf(): WebViewerLeaf | null {
    return this.stateManager.getLastActiveLeaf();
  }

  /** Resolve a Web Viewer leaf according to strategy. */
  async resolveLeaf(options: ResolveLeafOptions = {}): Promise<WebViewerLeaf> {
    this.assertAvailable();

    const {
      strategy = "active-or-last",
      focus = false,
      requireWebviewReady = false,
      timeoutMs = 15_000,
    } = options;

    const active = this.getActiveLeaf();
    if (active) {
      if (focus) this.app.workspace.setActiveLeaf(active, { focus: true });
      if (requireWebviewReady) await this.waitForWebviewReady(active, timeoutMs);
      return active;
    }

    if (strategy === "active-or-last" || strategy === "active-or-last-or-any") {
      const last = this.getLastActiveLeaf();
      if (last) {
        if (focus) this.app.workspace.setActiveLeaf(last, { focus: true });
        if (requireWebviewReady) await this.waitForWebviewReady(last, timeoutMs);
        return last;
      }
    }

    if (strategy === "active-or-last-or-any") {
      const anyLeaf = this.getLeaves()[0];
      if (anyLeaf) {
        if (focus) this.app.workspace.setActiveLeaf(anyLeaf, { focus: true });
        if (requireWebviewReady) await this.waitForWebviewReady(anyLeaf, timeoutMs);
        return anyLeaf;
      }
    }

    throw new WebViewerLeafNotFoundError("No Web Viewer leaf found.");
  }

  /**
   * Wait until the webview is mounted and first load finished.
   * If the fields don't exist (undefined), assume ready (fallback for older Obsidian versions).
   */
  async waitForWebviewReady(leaf: WebViewerLeaf, timeoutMs: number): Promise<void> {
    const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };

    // Fallback: if fields don't exist, assume ready (older Obsidian versions)
    if (view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined) {
      return;
    }

    if (view.webviewMounted && view.webviewFirstLoadFinished) return;

    await waitFor(
      () => Boolean(view.webviewMounted && view.webviewFirstLoadFinished),
      timeoutMs,
      100,
      "Waiting for Web Viewer webview ready"
    );
  }

  // --------------------------------------------------------------------------
  // State Manager Delegation (Active Web Tab)
  // --------------------------------------------------------------------------

  /**
   * Find a Web Viewer leaf by URL (best-effort normalized match).
   * @param url - The URL to search for
   * @param options - Optional disambiguation hints
   * @param options.title - Page title hint to help disambiguate multiple URL matches
   */
  findLeafByUrl(url: string, options: { title?: string } = {}): WebViewerLeaf | null {
    return this.stateManager.findLeafByUrl(url, options);
  }

  /** Get the current Active Web Tab state snapshot. */
  getActiveWebTabState(): ActiveWebTabStateSnapshot {
    return this.stateManager.getActiveWebTabState();
  }

  /** Subscribe to Active Web Tab state updates. */
  subscribeActiveWebTabState(listener: ActiveWebTabStateListener): () => void {
    return this.stateManager.subscribeActiveWebTabState(listener);
  }

  /**
   * Subscribe to webview load events.
   * Called when any Web Viewer tab finishes loading (did-finish-load event).
   * Useful for refreshing tab metadata (title, favicon, etc.) after page load.
   * @returns Unsubscribe function
   */
  subscribeToWebviewLoad(callback: () => void): () => void {
    return this.stateManager.subscribeToWebviewLoad(callback);
  }

  /**
   * Start tracking Active Web Tab state using workspace events.
   * Call this in plugin onload() and register the returned EventRefs.
   */
  startActiveWebTabTracking(
    options: StartActiveWebTabTrackingOptions = {}
  ): ActiveWebTabTrackingRefs {
    return this.stateManager.startActiveWebTabTracking(options);
  }

  /** Stop tracking Active Web Tab state and clean up event refs. */
  stopActiveWebTabTracking(): void {
    this.stateManager.stopActiveWebTabTracking();
  }

  // --------------------------------------------------------------------------
  // Commands
  // --------------------------------------------------------------------------

  /** Execute a Web Viewer command by ID. */
  async executeCommand(
    id: WebViewerCommandId,
    options: { leaf?: WebViewerLeaf; focusLeaf?: boolean } = {}
  ): Promise<void> {
    const cm = getCommandManager(this.app);
    if (!cm) throw new WebViewerError("Command manager unavailable.");

    const { leaf, focusLeaf = false } = options;
    if (leaf && focusLeaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });

    try {
      const result = cm.executeCommandById(id);
      if (result === false) throw new WebViewerError(`Command returned false: ${id}`);
    } catch (err) {
      logError(`Failed to execute command ${id}:`, err);
      throw new WebViewerError(`Failed to execute command ${id}: ${toErrorMessage(err)}`);
    }
  }

  // --------------------------------------------------------------------------
  // Internal Plugin API
  // --------------------------------------------------------------------------

  /** Flag to avoid repeated warnings about internal API structure issues */
  private internalApiWarned = false;

  /**
   * Get the internal Web Viewer plugin API if available.
   * Only caches successful results - allows retry if API was not found.
   */
  getInternalPluginApi(): WebViewerPluginApi | null {
    // Return cached API if already found
    if (this.internalPluginApi) return this.internalPluginApi;

    const api = getInternalWebViewerPluginApi(this.app, () => {
      if (!this.internalApiWarned) {
        this.internalApiWarned = true;
        logWarn(
          "[WebViewerService] internalPlugins.plugins has unexpected structure. " +
            "Web Viewer integration may not work correctly."
        );
      }
    });

    if (api) {
      this.internalPluginApi = api;
    }
    return api;
  }

  // --------------------------------------------------------------------------
  // Content Extraction, Navigation, View Controls (delegated to actions)
  // --------------------------------------------------------------------------

  getPageInfo(leaf: WebViewerLeaf): WebViewerPageInfo {
    return actions.getPageInfo(leaf);
  }
  async getReaderModeMarkdown(
    leaf: WebViewerLeaf,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    return actions.getReaderModeMarkdown(leaf, options);
  }
  async getSelectedText(leaf: WebViewerLeaf, trim = true): Promise<string> {
    return actions.getSelectedText(leaf, trim);
  }
  async getSelectedMarkdown(leaf: WebViewerLeaf): Promise<string> {
    return actions.getSelectedMarkdown(leaf);
  }
  async getPageMarkdown(leaf: WebViewerLeaf): Promise<string> {
    return actions.getPageMarkdown(leaf);
  }
  async getHtml(leaf: WebViewerLeaf, includeDocumentElement = true): Promise<string> {
    return actions.getHtml(leaf, includeDocumentElement);
  }

  // --------------------------------------------------------------------------
  // YouTube Transcript Extraction (delegated to actions)
  // --------------------------------------------------------------------------

  /**
   * Extract YouTube video ID from various URL formats.
   * @returns video ID or null if not a valid YouTube video URL
   */
  getYouTubeVideoId(url: string): string | null {
    return actions.getYouTubeVideoId(url);
  }

  /** Check if URL is a YouTube video page */
  isYouTubeVideoUrl(url: string): boolean {
    return actions.isYouTubeVideoUrl(url);
  }

  /**
   * Extract YouTube video transcript via DOM manipulation.
   * Automatically clicks the transcript button if needed and closes the panel after extraction.
   */
  async getYouTubeTranscript(
    leaf: WebViewerLeaf,
    options?: { timeoutMs?: number }
  ): Promise<actions.YouTubeTranscriptResult> {
    return actions.getYouTubeTranscript(leaf, options);
  }

  // --------------------------------------------------------------------------
  // Save (delegated to actions)
  // --------------------------------------------------------------------------

  async saveToVault(
    leaf: WebViewerLeaf,
    options: { preferCommand?: boolean; focusLeafBeforeCommand?: boolean } = {}
  ): Promise<SaveToVaultResult> {
    return actions.saveToVault(leaf, (id, opts) => this.executeCommand(id, opts), options);
  }
}
