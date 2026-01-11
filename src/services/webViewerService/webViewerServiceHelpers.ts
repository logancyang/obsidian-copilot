/**
 * Web Viewer Service Helpers
 *
 * Shared utilities for Web Viewer integration:
 * - Runtime shape checks
 * - Safe string/error helpers
 * - Turndown HTML to Markdown helpers
 * - Command manager adapters
 * - Workspace leaf helpers
 */

import type { App, WorkspaceLeaf } from "obsidian";
import TurndownService from "turndown";
import {
  type CommandManager,
  WEB_VIEWER_VIEW_TYPE,
  WebViewerError,
  type WebViewerPluginApi,
} from "@/services/webViewerService/webViewerServiceTypes";

// ============================================================================
// General Utilities
// ============================================================================

/**
 * Check if a value is a non-null object record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Convert an unknown value to a safe string without throwing.
 */
export function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

/**
 * Convert an unknown error to a human-readable message.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return toStringSafe(err);
}

/**
 * Delay for the provided number of milliseconds.
 */
export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until a predicate returns true, or throw after timeout.
 * @param predicate - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @param label - Description for error message if timeout occurs
 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number,
  label: string
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start >= timeoutMs) {
      throw new WebViewerError(`${label} timed out after ${timeoutMs}ms`);
    }
    await delay(intervalMs);
  }
}

// ============================================================================
// Turndown Helpers (HTML to Markdown)
// ============================================================================

/**
 * Resolve a potentially-relative URL against a base URL.
 */
export function resolveUrl(rawUrl: string, baseUrl: string): string {
  const input = (rawUrl ?? "").trim();
  if (!input) return "";
  if (!baseUrl) return input;
  try {
    return new URL(input, baseUrl).href;
  } catch {
    return input;
  }
}

/**
 * Format a Markdown link destination safely.
 * Wraps URLs containing spaces or parentheses in angle brackets.
 */
export function formatMarkdownDestination(url: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  return /[\s)]/.test(u) ? `<${u}>` : u;
}

/**
 * Create a TurndownService configured for Obsidian-friendly Markdown output.
 * @param baseUrl - Base URL for resolving relative links and images
 */
export function createTurndown(baseUrl: string): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  td.remove(["script", "style", "noscript"]);

  // Custom rule for links: resolve relative URLs
  td.addRule("webviewer-link", {
    filter: "a",
    replacement: (content, node) => {
      const el = node as HTMLAnchorElement;
      const rawHref = el.getAttribute("href") ?? "";
      const href = formatMarkdownDestination(resolveUrl(rawHref, baseUrl));
      const label = content?.trim() || el.textContent || href;
      if (!href) return label;
      return `[${label}](${href})`;
    },
  });

  // Custom rule for images: resolve relative URLs
  td.addRule("webviewer-image", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as HTMLImageElement;
      const alt = el.getAttribute("alt") ?? "";
      const rawSrc = el.getAttribute("src") ?? "";
      const src = formatMarkdownDestination(resolveUrl(rawSrc, baseUrl));
      if (!src) return "";
      return `![${alt}](${src})`;
    },
  });

  return td;
}

/**
 * Convert HTML string to Markdown using Turndown.
 * Uses DOMParser to avoid resource preloading (which causes ERR_FILE_NOT_FOUND for relative URLs).
 * @param html - The HTML string to convert
 * @param baseUrl - Base URL for resolving relative links and images
 * @returns The converted Markdown string, or empty string if input is empty/unparseable.
 *          Note: Turndown conversion errors will propagate to the caller.
 */
export function htmlToMarkdown(html: string, baseUrl: string): string {
  if (!html.trim()) return "";

  const td = createTurndown(baseUrl);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const wrapper = doc.body.firstElementChild;
  if (!wrapper) return "";

  return td
    .turndown(wrapper as HTMLElement)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================================
// Command Manager
// ============================================================================

/**
 * Get the (undocumented) Obsidian command manager API.
 */
export function getCommandManager(app: App): CommandManager | null {
  const commands = (app as unknown as { commands?: unknown }).commands;
  if (!commands || !isRecord(commands)) return null;
  if (typeof (commands as unknown as CommandManager).executeCommandById !== "function") return null;
  return commands as unknown as CommandManager;
}

/**
 * Check if a specific command is registered in Obsidian.
 */
export function isCommandRegistered(app: App, commandId: string): boolean {
  const cm = getCommandManager(app);
  if (!cm) return false;

  // Try commands map/object
  if (cm.commands) {
    if (cm.commands instanceof Map) {
      return cm.commands.has(commandId);
    }
    if (typeof cm.commands === "object") {
      return commandId in cm.commands;
    }
  }

  // Fallback: try listCommands
  if (typeof cm.listCommands === "function") {
    const list = cm.listCommands();
    return list.some((c) => c.id === commandId);
  }

  return false;
}

// ============================================================================
// Workspace Leaf Utilities
// ============================================================================

/**
 * Check if a leaf is still open in the workspace.
 */
export function isLeafStillOpen(app: App, leaf: WorkspaceLeaf): boolean {
  const leaves = app.workspace.getLeavesOfType(WEB_VIEWER_VIEW_TYPE);
  return leaves.includes(leaf);
}

// ============================================================================
// Internal Plugin API
// ============================================================================

/**
 * Try to extract a usable WebViewerPluginApi from a plugin entry.
 * Capability-based detection: requires openUrl OR handleOpenUrl.
 */
function tryExtractPluginApi(entry: unknown): WebViewerPluginApi | null {
  if (!isRecord(entry)) return null;
  if ((entry as { enabled?: unknown }).enabled !== true) return null;

  const instance = (entry as { instance?: unknown }).instance;
  if (!instance || !isRecord(instance)) return null;

  const maybe = instance as Partial<WebViewerPluginApi>;
  const hasOpenCapability =
    typeof maybe.openUrl === "function" || typeof maybe.handleOpenUrl === "function";

  if (hasOpenCapability) {
    return maybe as WebViewerPluginApi;
  }
  return null;
}

/**
 * Get the internal Web Viewer plugin API from Obsidian's internal plugins.
 * @param app - The Obsidian App instance
 * @param warnOnUnexpectedStructure - Callback to warn once about unexpected structure
 * @returns The WebViewerPluginApi if found, null otherwise
 */
export function getInternalWebViewerPluginApi(
  app: App,
  warnOnUnexpectedStructure?: () => void
): WebViewerPluginApi | null {
  const internalPlugins = (app as unknown as { internalPlugins?: unknown }).internalPlugins;
  if (!internalPlugins || !isRecord(internalPlugins)) return null;

  const plugins = (internalPlugins as { plugins?: unknown }).plugins;
  if (!plugins) return null;

  // Strategy 1: Direct key lookup using WEB_VIEWER_VIEW_TYPE
  const directEntry =
    plugins instanceof Map
      ? plugins.get(WEB_VIEWER_VIEW_TYPE)
      : isRecord(plugins)
        ? (plugins as Record<string, unknown>)[WEB_VIEWER_VIEW_TYPE]
        : null;

  if (directEntry) {
    const api = tryExtractPluginApi(directEntry);
    if (api) return api;
  }

  // Strategy 2: Fallback to scanning all entries
  let entries: unknown[];
  if (plugins instanceof Map) {
    entries = Array.from(plugins.values());
  } else if (isRecord(plugins)) {
    entries = Object.values(plugins);
  } else {
    // Unexpected structure - warn once
    if (warnOnUnexpectedStructure) {
      warnOnUnexpectedStructure();
    }
    return null;
  }

  for (const entry of entries) {
    const api = tryExtractPluginApi(entry);
    if (api) return api;
  }

  return null;
}
