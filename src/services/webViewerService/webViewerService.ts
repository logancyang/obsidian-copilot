import type { App } from "obsidian";

import { logWarn } from "@/logger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import * as actions from "@/services/webViewerService/webViewerServiceActions";
import {
  getInternalWebViewerPluginApi,
  isCommandRegistered,
  waitFor,
} from "@/services/webViewerService/webViewerServiceHelpers";
import { WebViewerStateManager } from "@/services/webViewerService/webViewerServiceState";
import {
  type ActiveWebTabStateListener,
  type ActiveWebTabStateSnapshot,
  type ActiveWebTabTrackingRefs,
  isWebViewerLeaf,
  type StartActiveWebTabTrackingOptions,
  WEB_VIEWER_COMMANDS,
  WEB_VIEWER_VIEW_TYPE,
  type WebViewerAvailability,
  type WebViewerLeaf,
  type WebViewerPageInfo,
  type WebViewerPluginApi,
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
}
