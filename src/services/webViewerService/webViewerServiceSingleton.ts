/**
 * Web Viewer Service Singleton
 *
 * Provides cached WebViewerService instances and active-tab tracking.
 */

import type { App } from "obsidian";

import { WebViewerService } from "@/services/webViewerService/webViewerService";
import type {
  ActiveWebTabTrackingRefs,
  StartActiveWebTabTrackingOptions,
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
// Active Web Tab Tracking
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
