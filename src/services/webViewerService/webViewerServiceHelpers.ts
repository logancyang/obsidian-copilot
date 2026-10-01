import type { App, WorkspaceLeaf } from "obsidian";
import TurndownService from "turndown";
import {
  type CommandManager,
  WEB_VIEWER_VIEW_TYPE,
  WebViewerError,
  type WebViewerPluginApi,
} from "@/services/webViewerService/webViewerServiceTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "function") return value.toString();
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  } catch {
    return "";
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

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

function resolveUrl(rawUrl: string, baseUrl: string): string {
  const input = (rawUrl ?? "").trim();
  if (!input) return "";
  if (!baseUrl) return input;
  try {
    return new URL(input, baseUrl).href;
  } catch {
    return input;
  }
}

function formatMarkdownDestination(url: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  return /[\s)]/.test(u) ? `<${u}>` : u;
}

function createTurndown(baseUrl: string): TurndownService {
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

function getCommandManager(app: App): CommandManager | null {
  const commands = (app as unknown as { commands?: unknown }).commands;
  if (!commands || !isRecord(commands)) return null;
  if (typeof (commands as unknown as CommandManager).executeCommandById !== "function") return null;
  return commands as unknown as CommandManager;
}

export function isCommandRegistered(app: App, commandId: string): boolean {
  const cm = getCommandManager(app);
  if (!cm) return false;

  if (cm.commands) {
    if (cm.commands instanceof Map) {
      return cm.commands.has(commandId);
    }
    if (typeof cm.commands === "object") {
      return commandId in cm.commands;
    }
  }

  if (typeof cm.listCommands === "function") {
    const list = cm.listCommands();
    return list.some((c) => c.id === commandId);
  }

  return false;
}

export function isLeafStillOpen(app: App, leaf: WorkspaceLeaf): boolean {
  const leaves = app.workspace.getLeavesOfType(WEB_VIEWER_VIEW_TYPE);
  return leaves.includes(leaf);
}

function tryExtractPluginApi(entry: unknown): WebViewerPluginApi | null {
  if (!isRecord(entry)) return null;
  if ((entry as { enabled?: unknown }).enabled !== true) return null;

  const instance = (entry as { instance?: unknown }).instance;
  if (!instance || !isRecord(instance)) return null;

  const maybe = instance as Partial<WebViewerPluginApi>;
  const hasOpenCapability =
    typeof maybe.openUrl === "function" || typeof maybe.handleOpenUrl === "function";

  if (hasOpenCapability) {
    return maybe;
  }
  return null;
}

export function getInternalWebViewerPluginApi(
  app: App,
  warnOnUnexpectedStructure?: () => void
): WebViewerPluginApi | null {
  const internalPlugins = (app as unknown as { internalPlugins?: unknown }).internalPlugins;
  if (!internalPlugins || !isRecord(internalPlugins)) return null;

  const plugins = (internalPlugins as { plugins?: unknown }).plugins;
  if (!plugins) return null;

  const directEntry =
    plugins instanceof Map
      ? plugins.get(WEB_VIEWER_VIEW_TYPE)
      : isRecord(plugins)
        ? plugins[WEB_VIEWER_VIEW_TYPE]
        : null;

  if (directEntry) {
    const api = tryExtractPluginApi(directEntry);
    if (api) return api;
  }

  let entries: unknown[];
  if (plugins instanceof Map) {
    entries = Array.from(plugins.values());
  } else if (isRecord(plugins)) {
    entries = Object.values(plugins);
  } else {
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
