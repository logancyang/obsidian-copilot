/**
 * Web Viewer Service Types
 *
 * Constants, types, interfaces, error classes, and type guards for Web Viewer integration.
 * Note: Web Viewer is an internal Obsidian API surface that may change without notice.
 * Desktop-only (depends on Electron webview).
 */

import type { Command, EventRef, View, WorkspaceLeaf } from "obsidian";

import type { WebTabContext } from "@/types/message";

// ============================================================================
// Constants
// ============================================================================

/** Obsidian Web Viewer view type string (undocumented/internal). */
export const WEB_VIEWER_VIEW_TYPE = "webviewer";

/** Official Web Viewer command IDs (core plugin). Only includes commands actually used. */
export const WEB_VIEWER_COMMANDS = {
  OPEN: "webviewer:open",
  SAVE_TO_VAULT: "webviewer:save-to-vault",
} as const;

export type WebViewerCommandId = (typeof WEB_VIEWER_COMMANDS)[keyof typeof WEB_VIEWER_COMMANDS];

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Supported Web Viewer render modes. */
export type WebViewerMode = "webview" | "reader";

/** Reader-mode content returned by getReaderModeContent(). */
export interface WebViewerReaderContent {
  md: string;
}


/**
 * Minimal shape of Electron's webview element as observed in Obsidian Web Viewer.
 * Note: This is not part of the official Obsidian plugin API.
 * Some methods are marked optional as they may not exist in all Electron versions.
 */
export interface WebviewElement extends HTMLElement {
  // Content extraction (core - always available)
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getURL(): string;
  getTitle(): string;

}

/**
 * Web Viewer view instance (runtime-observed, undocumented).
 * These fields/methods may change without notice.
 */
export interface WebViewerView extends View {
  // Properties
  url: string;
  title: string;
  faviconUrl: string;
  mode: WebViewerMode;
  webview: WebviewElement;
  webviewMounted: boolean;
  webviewFirstLoadFinished: boolean;

  // Methods (only those actually used)
  getReaderModeContent(): WebViewerReaderContent | Promise<WebViewerReaderContent>;
  saveAsMarkdown(): Promise<void> | void;
}

/** Workspace leaf that hosts a Web Viewer view. */
export type WebViewerLeaf = WorkspaceLeaf & { view: WebViewerView };

/** Internal plugin API surfaced by the core Web Viewer plugin. */
export interface WebViewerPluginApi {
  /** Primary method to open a URL (may open new tab). */
  openUrl?(url: string): void;
  /** Fallback method to handle opening a URL. */
  handleOpenUrl?(url: string): void;
  /** Get the configured search engine URL. Optional capability. */
  getSearchEngineUrl?(query?: string): string;
}

/** Command manager API (undocumented on App typings). */
export interface CommandManager {
  executeCommandById(id: string): unknown;
  listCommands?: () => Command[];
  commands?: Map<string, Command> | Record<string, Command>;
}

/** Strategy for resolving a target Web Viewer leaf. */
export type ResolveStrategy = "active-only" | "active-or-last" | "active-or-last-or-any";

/** Options for resolving a target Web Viewer leaf. */
export interface ResolveLeafOptions {
  strategy?: ResolveStrategy;
  focus?: boolean;
  requireWebviewReady?: boolean;
  timeoutMs?: number;
}

/** Web Viewer availability details. */
export interface WebViewerAvailability {
  supported: boolean;
  available: boolean;
  platform: "desktop" | "mobile";
  reason?: string;
}

/** Page info from a Web Viewer leaf. */
export interface WebViewerPageInfo {
  url: string;
  title: string;
  faviconUrl: string;
  mode: WebViewerMode;
}


/** Result of save-to-vault operation. */
export interface SaveToVaultResult {
  method: "command" | "view.saveAsMarkdown";
}

// ============================================================================
// Errors
// ============================================================================

/** Base error class for Web Viewer operations. */
export class WebViewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerError";
    Object.setPrototypeOf(this, WebViewerError.prototype);
  }
}

/** Error thrown when Web Viewer is not supported on the current platform. */
export class WebViewerUnsupportedError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerUnsupportedError";
    Object.setPrototypeOf(this, WebViewerUnsupportedError.prototype);
  }
}

/** Error thrown when no Web Viewer leaf is found. */
export class WebViewerLeafNotFoundError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerLeafNotFoundError";
    Object.setPrototypeOf(this, WebViewerLeafNotFoundError.prototype);
  }
}

/** Error thrown when webview element is not available or not ready. */
export class WebviewUnavailableError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebviewUnavailableError";
    Object.setPrototypeOf(this, WebviewUnavailableError.prototype);
  }
}

/** Error thrown when an operation times out. */
export class WebViewerTimeoutError extends WebViewerError {
  constructor(message: string) {
    super(message);
    this.name = "WebViewerTimeoutError";
    Object.setPrototypeOf(this, WebViewerTimeoutError.prototype);
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a leaf is a Web Viewer leaf.
 */
export function isWebViewerLeaf(leaf: WorkspaceLeaf | null): leaf is WebViewerLeaf {
  if (!leaf) return false;
  const view = leaf.view as View | undefined;
  if (!view || typeof view !== "object") return false;
  const getViewType = view.getViewType;
  return typeof getViewType === "function" && leaf.view.getViewType() === WEB_VIEWER_VIEW_TYPE;
}

/**
 * Ensure the leaf has a usable webview element, throwing if not available.
 */
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

// ============================================================================
// Active Web Tab State Types
// ============================================================================

/**
 * Snapshot for the Active Web Tab single-source-of-truth state.
 *
 * - `activeWebTabForMentions`: Drives whether the "Active Web Tab" @mention option is available.
 * - `activeOrLastWebTab`: Best-effort tab metadata for pill display (active Web Viewer tab or last active).
 */
export interface ActiveWebTabStateSnapshot {
  activeWebTabForMentions: WebTabContext | null;
  activeOrLastWebTab: WebTabContext | null;
}

/**
 * Options for Active Web Tab tracking.
 */
export interface StartActiveWebTabTrackingOptions {
  /**
   * View types that should preserve `activeWebTabForMentions` when they become active.
   * Example: preserve the last active Web Viewer tab while the Copilot chat view is focused.
   */
  preserveOnViewTypes?: string[];
}

/**
 * Event refs returned by `startActiveWebTabTracking()`.
 */
export interface ActiveWebTabTrackingRefs {
  activeLeafRef: EventRef;
  layoutRef: EventRef;
}

/** Listener type for Active Web Tab state changes. */
export type ActiveWebTabStateListener = (state: ActiveWebTabStateSnapshot) => void;
