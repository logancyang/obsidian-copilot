/**
 * Web Viewer Service Actions
 *
 * Stateless (function-based) implementations for operating on a Web Viewer leaf/webview.
 * These functions do not hold state and receive all dependencies as parameters.
 */

import { logError, logInfo, logWarn } from "@/logger";
import {
  requireWebview,
  type SaveToVaultResult,
  WEB_VIEWER_COMMANDS,
  type WebViewerCommandId,
  type WebViewerLeaf,
  type WebViewerPageInfo,
  WebViewerTimeoutError,
} from "@/services/webViewerService/webViewerServiceTypes";
import { htmlToMarkdown, toStringSafe } from "@/services/webViewerService/webViewerServiceHelpers";

// ============================================================================
// Action Function Types
// ============================================================================

/** Function type for executing Web Viewer commands. */
export type ExecuteWebViewerCommand = (
  id: WebViewerCommandId,
  options?: { leaf?: WebViewerLeaf; focusLeaf?: boolean }
) => Promise<void>;

// ============================================================================
// Content Extraction
// ============================================================================

/** Get basic page info from a Web Viewer leaf. */
export function getPageInfo(leaf: WebViewerLeaf): WebViewerPageInfo {
  return {
    url: typeof leaf.view?.url === "string" ? leaf.view.url : "",
    title: typeof leaf.view?.title === "string" ? leaf.view.title : "",
    faviconUrl: typeof leaf.view?.faviconUrl === "string" ? leaf.view.faviconUrl : "",
    mode: leaf.view?.mode === "reader" ? "reader" : "webview",
  };
}

/**
 * Get Reader-mode Markdown content for the current page.
 * @param leaf - The Web Viewer leaf to extract content from
 * @param options - Optional configuration
 * @param options.signal - AbortSignal to cancel the operation
 */
export async function getReaderModeMarkdown(
  leaf: WebViewerLeaf,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  const { signal } = options;

  // Check if already aborted before starting
  if (signal?.aborted) {
    throw new WebViewerTimeoutError("Operation was aborted");
  }

  try {
    const contentPromise = Promise.resolve(leaf.view.getReaderModeContent());

    // If no signal provided, just await the promise directly
    if (!signal) {
      const content = await contentPromise;
      return typeof content?.md === "string" ? content.md : "";
    }

    // Race between content fetch and abort signal
    const content = await new Promise<{ md?: string } | undefined>((resolve, reject) => {
      const abortHandler = () => {
        reject(new WebViewerTimeoutError("Operation was aborted"));
      };

      // Listen for abort
      signal.addEventListener("abort", abortHandler, { once: true });

      contentPromise
        .then((result) => {
          signal.removeEventListener("abort", abortHandler);
          resolve(result);
        })
        .catch((err) => {
          signal.removeEventListener("abort", abortHandler);
          reject(err);
        });
    });

    return typeof content?.md === "string" ? content.md : "";
  } catch (err) {
    // Re-throw timeout errors as-is
    if (err instanceof WebViewerTimeoutError) {
      throw err;
    }
    logError("Failed to get reader mode content:", err);
    throw err;
  }
}

/** Get selected text inside the embedded page (webview). */
export async function getSelectedText(leaf: WebViewerLeaf, trim = true): Promise<string> {
  const webview = requireWebview(leaf);
  const code = `(() => { try { return window.getSelection?.()?.toString?.() ?? ""; } catch { return ""; } })()`;

  try {
    const raw = await webview.executeJavaScript(code);
    const text = toStringSafe(raw);
    return trim ? text.trim() : text;
  } catch (err) {
    logError("Failed to get selected text:", err);
    throw err;
  }
}

/**
 * Get selected content as Markdown (with images/links preserved).
 * Uses Turndown to convert HTML to Markdown.
 */
export async function getSelectedMarkdown(leaf: WebViewerLeaf): Promise<string> {
  const webview = requireWebview(leaf);

  // Get base URL for resolving relative paths
  let baseUrl = "";
  try {
    baseUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
  } catch {
    baseUrl = leaf.view?.url ?? "";
  }

  // Get selection HTML from webview
  const code = `(() => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const div = document.createElement("div");
  for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
  return div.innerHTML;
})()`;

  let html = "";
  try {
    const raw = await webview.executeJavaScript(code);
    html = toStringSafe(raw);
  } catch (err) {
    logError("Failed to get selection HTML:", err);
    throw err;
  }

  try {
    return htmlToMarkdown(html, baseUrl);
  } catch (err) {
    logError("Failed to convert HTML to Markdown:", err);
    throw err;
  }
}

/**
 * Get the entire page content as Markdown.
 * Uses Turndown to convert the full page HTML to Markdown.
 * Unlike getReaderModeMarkdown which uses Obsidian's reader mode extraction,
 * this method converts the raw DOM content directly.
 */
export async function getPageMarkdown(leaf: WebViewerLeaf): Promise<string> {
  const webview = requireWebview(leaf);

  // Get base URL for resolving relative paths
  let baseUrl = "";
  try {
    baseUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
  } catch {
    baseUrl = leaf.view?.url ?? "";
  }

  // Get body HTML, excluding script/style/noscript tags
  const code = `(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
    return clone.innerHTML;
  })()`;

  let html = "";
  try {
    const raw = await webview.executeJavaScript(code);
    html = toStringSafe(raw);
  } catch (err) {
    logError("Failed to get page HTML:", err);
    throw err;
  }

  try {
    return htmlToMarkdown(html, baseUrl);
  } catch (err) {
    logError("Failed to convert page HTML to Markdown:", err);
    throw err;
  }
}

/** Get full HTML from the embedded page. */
export async function getHtml(leaf: WebViewerLeaf, includeDocumentElement = true): Promise<string> {
  const webview = requireWebview(leaf);
  const code = includeDocumentElement
    ? `(() => { try { return document.documentElement?.outerHTML ?? ""; } catch { return ""; } })()`
    : `(() => { try { return document.body?.outerHTML ?? ""; } catch { return ""; } })()`;

  try {
    const raw = await webview.executeJavaScript(code);
    return toStringSafe(raw);
  } catch (err) {
    logError("Failed to get HTML:", err);
    throw err;
  }
}

// ============================================================================
// Save & Export
// ============================================================================

/** Save the current Web Viewer page to the vault. */
export async function saveToVault(
  leaf: WebViewerLeaf,
  executeCommand: ExecuteWebViewerCommand,
  options: { preferCommand?: boolean; focusLeafBeforeCommand?: boolean } = {}
): Promise<SaveToVaultResult> {
  const { preferCommand = true, focusLeafBeforeCommand = true } = options;

  if (preferCommand) {
    try {
      await executeCommand(WEB_VIEWER_COMMANDS.SAVE_TO_VAULT, {
        leaf,
        focusLeaf: focusLeafBeforeCommand,
      });
      logInfo("Saved via webviewer:save-to-vault command");
      return { method: "command" };
    } catch (err) {
      logWarn("save-to-vault command failed, falling back:", err);
    }
  }

  try {
    await Promise.resolve(leaf.view.saveAsMarkdown());
    logInfo("Saved via view.saveAsMarkdown()");
    return { method: "view.saveAsMarkdown" };
  } catch (err) {
    logError("Failed to save Web Viewer page:", err);
    throw err;
  }
}
