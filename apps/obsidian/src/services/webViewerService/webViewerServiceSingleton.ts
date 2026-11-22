import type { App } from "obsidian";

import { WebViewerService } from "@/services/webViewerService/webViewerService";
import type {
  ActiveWebTabTrackingRefs,
  StartActiveWebTabTrackingOptions,
} from "@/services/webViewerService/webViewerServiceTypes";

const serviceCache = new WeakMap<App, WebViewerService>();

export function getWebViewerService(app: App): WebViewerService {
  const cached = serviceCache.get(app);
  if (cached) return cached;

  const service = new WebViewerService(app);
  serviceCache.set(app, service);
  return service;
}

export function startActiveWebTabTracking(
  app: App,
  options?: StartActiveWebTabTrackingOptions
): ActiveWebTabTrackingRefs {
  return getWebViewerService(app).startActiveWebTabTracking(options);
}
