import type { Command, EventRef, View, WorkspaceLeaf } from "obsidian";

import type { WebTabContext } from "@/types/message";

export const WEB_VIEWER_VIEW_TYPE = "webviewer";

export const WEB_VIEWER_COMMANDS = {
  OPEN: "webviewer:open",
} as const;

export type WebViewerMode = "webview" | "reader";

export interface WebViewerReaderContent {
  md: string;
}

export interface WebviewElement extends HTMLElement {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getURL(): string;
  getTitle(): string;
}

export interface WebViewerView extends View {
  url: string;
  title: string;
  faviconUrl: string;
  mode: WebViewerMode;
  webview: WebviewElement;
  webviewMounted: boolean;
  webviewFirstLoadFinished: boolean;

  getReaderModeContent(): WebViewerReaderContent | Promise<WebViewerReaderContent>;
}

export type WebViewerLeaf = WorkspaceLeaf & { view: WebViewerView };

export interface WebViewerPluginApi {
  openUrl?(url: string): void;
  handleOpenUrl?(url: string): void;
  getSearchEngineUrl?(query?: string): string;
}

export interface CommandManager {
  executeCommandById(id: string): unknown;
  listCommands?: () => Command[];
  commands?: Map<string, Command> | Record<string, Command>;
}

export interface WebViewerAvailability {
  supported: boolean;
  available: boolean;
  platform: "desktop" | "mobile";
  reason?: string;
}

export interface WebViewerPageInfo {
  url: string;
  title: string;
  faviconUrl: string;
  mode: WebViewerMode;
}

export class WebViewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerError";
    Object.setPrototypeOf(this, WebViewerError.prototype);
  }
}

class WebviewUnavailableError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebviewUnavailableError";
    Object.setPrototypeOf(this, WebviewUnavailableError.prototype);
  }
}

export class WebViewerTimeoutError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerTimeoutError";
    Object.setPrototypeOf(this, WebViewerTimeoutError.prototype);
  }
}

export function isWebViewerLeaf(leaf: WorkspaceLeaf | null): leaf is WebViewerLeaf {
  if (!leaf) return false;
  const view = leaf.view as View | undefined;
  if (!view || typeof view !== "object") return false;
  return typeof view.getViewType === "function" && view.getViewType() === WEB_VIEWER_VIEW_TYPE;
}

export function requireWebview(leaf: WebViewerLeaf): WebviewElement {
  const webview = leaf.view?.webview as unknown;
  if (
    !webview ||
    typeof webview !== "object" ||
    typeof (webview as unknown as WebviewElement).executeJavaScript !== "function"
  ) {
    throw new WebviewUnavailableError(
      "Web Viewer webview is unavailable. The view may not be fully initialized."
    );
  }
  return webview as unknown as WebviewElement;
}

export interface ActiveWebTabStateSnapshot {
  activeWebTabForMentions: WebTabContext | null;
  activeOrLastWebTab: WebTabContext | null;
}

export interface StartActiveWebTabTrackingOptions {
  preserveOnViewTypes?: string[];
}

export interface ActiveWebTabTrackingRefs {
  activeLeafRef: EventRef;
  layoutRef: EventRef;
}

export type ActiveWebTabStateListener = (state: ActiveWebTabStateSnapshot) => void;
