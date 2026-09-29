import type { App } from "obsidian";

import { logError, logWarn } from "@/logger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
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

export class WebViewerService {
  private readonly app: App;
  private internalPluginApi: WebViewerPluginApi | null = null;

  private readonly stateManager: WebViewerStateManager;

  constructor(app: App) {
    this.app = app;

    this.stateManager = new WebViewerStateManager({
      app,
      isSupportedPlatform: () => this.isSupportedPlatform(),
      getActiveLeaf: () => this.getActiveLeaf(),
      getLeaves: () => this.getLeaves(),
      getPageInfo: (leaf) => actions.getPageInfo(leaf),
    });
  }

  isSupportedPlatform(): boolean {
    return isDesktopRuntime();
  }

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

  assertAvailable(): void {
    const availability = this.getAvailability();
    if (!availability.supported) {
      throw new WebViewerUnsupportedError(availability.reason ?? "Web Viewer unsupported.");
    }
    if (!availability.available) {
      throw new WebViewerError(availability.reason ?? "Web Viewer is not available.");
    }
  }

  getLeaves(): WebViewerLeaf[] {
    if (!this.isSupportedPlatform()) return [];
    return this.app.workspace.getLeavesOfType(WEB_VIEWER_VIEW_TYPE) as WebViewerLeaf[];
  }

  getActiveLeaf(): WebViewerLeaf | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    return isWebViewerLeaf(leaf) ? leaf : null;
  }

  getLastActiveLeaf(): WebViewerLeaf | null {
    return this.stateManager.getLastActiveLeaf();
  }

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

  async waitForWebviewReady(leaf: WebViewerLeaf, timeoutMs: number): Promise<void> {
    const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };

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

  findLeafByUrl(url: string, options: { title?: string } = {}): WebViewerLeaf | null {
    return this.stateManager.findLeafByUrl(url, options);
  }

  getActiveWebTabState(): ActiveWebTabStateSnapshot {
    return this.stateManager.getActiveWebTabState();
  }

  subscribeActiveWebTabState(listener: ActiveWebTabStateListener): () => void {
    return this.stateManager.subscribeActiveWebTabState(listener);
  }

  subscribeToWebviewLoad(callback: () => void): () => void {
    return this.stateManager.subscribeToWebviewLoad(callback);
  }

  startActiveWebTabTracking(
    options: StartActiveWebTabTrackingOptions = {}
  ): ActiveWebTabTrackingRefs {
    return this.stateManager.startActiveWebTabTracking(options);
  }

  stopActiveWebTabTracking(): void {
    this.stateManager.stopActiveWebTabTracking();
  }

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

  private internalApiWarned = false;

  getInternalPluginApi(): WebViewerPluginApi | null {
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

  getYouTubeVideoId(url: string): string | null {
    return actions.getYouTubeVideoId(url);
  }

  async getYouTubeTranscript(
    leaf: WebViewerLeaf,
    options?: { timeoutMs?: number }
  ): Promise<actions.YouTubeTranscriptResult> {
    return actions.getYouTubeTranscript(leaf, options);
  }

  async saveToVault(
    leaf: WebViewerLeaf,
    options: { preferCommand?: boolean; focusLeafBeforeCommand?: boolean } = {}
  ): Promise<SaveToVaultResult> {
    return actions.saveToVault(leaf, (id, opts) => this.executeCommand(id, opts), options);
  }
}
