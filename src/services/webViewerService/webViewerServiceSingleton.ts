/**
 * Web Viewer Service Singleton & Convenience Functions
 *
 * Provides cached WebViewerService instances and convenience functions
 * for common Web Viewer operations.
 */

import type { App } from "obsidian";

import { WebViewerService } from "@/services/webViewerService/webViewerService";
import type {
  ActiveWebTabTrackingRefs,
  ResolveLeafOptions,
  SaveToVaultResult,
  StartActiveWebTabTrackingOptions,
  WebViewerLeaf,
  WebViewerPageInfo,
} from "@/services/webViewerService/webViewerServiceTypes";

// ============================================================================
// Singleton Cache
// ============================================================================

const serviceCache = new WeakMap<App, WebViewerService>();

/**
 * Get a cached WebViewerService instance for the provided App.
 * Creates a new instance if one doesn't exist.
 */
export function getWebViewerService(app: App): WebViewerService {
  const cached = serviceCache.get(app);
  if (cached) return cached;

  const service = new WebViewerService(app);
  serviceCache.set(app, service);
  return service;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Start tracking the Active Web Tab state (SSoT for UI).
 */
export function startActiveWebTabTracking(
  app: App,
  options?: StartActiveWebTabTrackingOptions
): ActiveWebTabTrackingRefs {
  return getWebViewerService(app).startActiveWebTabTracking(options);
}

/**
 * Resolve the current Web Viewer leaf.
 */
export async function resolveWebViewerLeaf(app: App, options?: ResolveLeafOptions): Promise<WebViewerLeaf> {
  return getWebViewerService(app).resolveLeaf(options);
}

/**
 * Get reader-mode Markdown from the current Web Viewer.
 */
export async function getWebViewerMarkdown(app: App, options?: ResolveLeafOptions): Promise<string> {
  const leaf = await resolveWebViewerLeaf(app, options);
  return getWebViewerService(app).getReaderModeMarkdown(leaf);
}

/**
 * Get selected text from the current Web Viewer.
 */
export async function getWebViewerSelectedText(
  app: App,
  trim = true,
  options?: ResolveLeafOptions
): Promise<string> {
  const leaf = await resolveWebViewerLeaf(app, options);
  return getWebViewerService(app).getSelectedText(leaf, trim);
}

/**
 * Get selected content as Markdown from the current Web Viewer.
 */
export async function getWebViewerSelectedMarkdown(app: App, options?: ResolveLeafOptions): Promise<string> {
  const leaf = await resolveWebViewerLeaf(app, options);
  return getWebViewerService(app).getSelectedMarkdown(leaf);
}

/**
 * Get page info from the current Web Viewer.
 */
export async function getWebViewerPageInfo(
  app: App,
  options?: ResolveLeafOptions
): Promise<WebViewerPageInfo> {
  const leaf = await resolveWebViewerLeaf(app, options);
  return getWebViewerService(app).getPageInfo(leaf);
}

/**
 * Save the current Web Viewer page to vault.
 */
export async function saveWebViewerToVault(
  app: App,
  saveOptions?: { preferCommand?: boolean; focusLeafBeforeCommand?: boolean },
  resolveOptions?: ResolveLeafOptions
): Promise<SaveToVaultResult> {
  const leaf = await resolveWebViewerLeaf(app, { ...resolveOptions, focus: true });
  return getWebViewerService(app).saveToVault(leaf, saveOptions);
}
