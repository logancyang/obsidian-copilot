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
// YouTube Transcript Extraction
// ============================================================================

/**
 * Extract YouTube video ID from various URL formats.
 * Supports: youtube.com/watch, youtu.be, youtube.com/shorts, m.youtube.com, embed
 * @returns video ID or null if not a valid YouTube video URL
 */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

    // youtube.com/watch?v=xxx or youtube.com/watch?v=xxx&t=120
    if (hostname === "youtube.com" && u.pathname === "/watch") {
      return u.searchParams.get("v");
    }

    // youtu.be/xxx or youtu.be/xxx?t=120
    if (hostname === "youtu.be" && u.pathname.length > 1) {
      return u.pathname.slice(1).split("/")[0];
    }

    // youtube.com/shorts/xxx
    if (hostname === "youtube.com" && u.pathname.startsWith("/shorts/")) {
      return u.pathname.split("/")[2] || null;
    }

    // youtube.com/embed/xxx
    if (hostname === "youtube.com" && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Check if URL is a YouTube video page */
export function isYouTubeVideoUrl(url: string): boolean {
  return getYouTubeVideoId(url) !== null;
}

/** YouTube transcript segment */
export interface YouTubeTranscriptSegment {
  timestamp: string;
  text: string;
}

/** YouTube video metadata and transcript extraction result */
export interface YouTubeTranscriptResult {
  videoId: string;
  title: string;
  channel: string;
  description?: string;
  uploadDate?: string;
  duration?: string;
  genre?: string;
  transcript: YouTubeTranscriptSegment[];
}

/** Runtime validation for transcript result */
function isValidTranscriptResult(data: unknown): data is YouTubeTranscriptResult {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.videoId === "string" &&
    typeof d.title === "string" &&
    typeof d.channel === "string" &&
    (d.description === undefined || typeof d.description === "string") &&
    (d.uploadDate === undefined || typeof d.uploadDate === "string") &&
    (d.duration === undefined || typeof d.duration === "string") &&
    (d.genre === undefined || typeof d.genre === "string") &&
    Array.isArray(d.transcript) &&
    d.transcript.every(
      (seg: unknown) =>
        typeof seg === "object" &&
        seg !== null &&
        typeof (seg as Record<string, unknown>).timestamp === "string" &&
        typeof (seg as Record<string, unknown>).text === "string"
    )
  );
}

/**
 * Extract YouTube video transcript via DOM manipulation.
 * Automatically clicks the transcript button if needed and closes the panel after extraction.
 * @param leaf - The Web Viewer leaf containing the YouTube page
 * @param options.timeoutMs - Maximum time to wait for transcript to load (default: 10000ms)
 */
export async function getYouTubeTranscript(
  leaf: WebViewerLeaf,
  options: { timeoutMs?: number } = {}
): Promise<YouTubeTranscriptResult> {
  const webview = requireWebview(leaf);
  const { timeoutMs = 10000 } = options;
  const maxAttempts = Math.ceil(timeoutMs / 500);

  // Get the actual page URL and extract videoId (handles redirects and all URL formats)
  let pageUrl = "";
  try {
    pageUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
  } catch {
    pageUrl = "";
  }
  if (!pageUrl) pageUrl = leaf.view?.url ?? "";

  const videoId = getYouTubeVideoId(pageUrl);
  if (!videoId) {
    throw new Error("Not a YouTube video page");
  }

  // Pass videoId into the script to avoid re-parsing URL (fixes /shorts/, /embed/, youtu.be support)
  const code = `(async () => {
    const videoId = ${JSON.stringify(videoId)};

    // =========================================================================
    // Step 1: Extract video metadata from JSON-LD (structured data)
    // JSON-LD is more reliable than DOM selectors as it's machine-readable
    // =========================================================================
    let title = '';
    let channel = '';
    let description = '';
    let uploadDate = '';
    let duration = '';
    let genre = '';

    // Helper to extract fields from a VideoObject schema
    const extractVideoObject = (data) => {
      if (!data || data['@type'] !== 'VideoObject') return;
      if (!title && data.name && typeof data.name === 'string') {
        title = data.name;
      }
      if (!description && data.description && typeof data.description === 'string') {
        description = data.description;
      }
      if (!uploadDate && data.uploadDate && typeof data.uploadDate === 'string') {
        uploadDate = data.uploadDate;
      }
      // JSON-LD duration is ISO 8601 format (e.g., "PT12M34S"), convert to readable format
      if (!duration && data.duration && typeof data.duration === 'string') {
        const match = data.duration.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
        if (match) {
          const h = match[1] ? match[1] + ':' : '';
          const m = match[2] || '0';
          const s = match[3] || '0';
          duration = h + (h ? m.padStart(2, '0') : m) + ':' + s.padStart(2, '0');
        }
      }
      if (!genre && data.genre) {
        genre = Array.isArray(data.genre) ? data.genre.join(', ') : String(data.genre);
      }
      // author can be string, object {name}, or array [{name}]
      if (!channel && data.author) {
        const author = data.author;
        if (typeof author === 'string') {
          channel = author;
        } else if (Array.isArray(author) && author[0]?.name) {
          channel = String(author[0].name);
        } else if (author?.name) {
          channel = String(author.name);
        }
      }
    };

    // Parse all JSON-LD scripts, handling various formats (@graph, array, single object)
    const ldJsonEls = document.querySelectorAll('script[type="application/ld+json"]');
    for (const el of ldJsonEls) {
      try {
        const data = JSON.parse(el.textContent || '');
        if (Array.isArray(data)) {
          for (const item of data) {
            extractVideoObject(item);
          }
        } else if (data['@graph'] && Array.isArray(data['@graph'])) {
          for (const item of data['@graph']) {
            extractVideoObject(item);
          }
        } else {
          extractVideoObject(data);
        }
        // Stop if we have all essential fields
        if (title && channel && description) break;
      } catch {}
    }

    // =========================================================================
    // Step 2: Fallback to DOM selectors for missing metadata
    // =========================================================================
    if (!title) {
      title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
           || document.querySelector('#title h1')?.textContent?.trim() || '';
    }
    if (!channel) {
      channel = document.querySelector('#owner #channel-name a')?.textContent?.trim()
             || document.querySelector('#channel-name a')?.textContent?.trim()
             || document.querySelector('#channel-name')?.textContent?.trim() || '';
    }
    if (!duration) {
      duration = document.querySelector('#ytd-player .ytp-time-duration')?.textContent?.trim() || '';
    }

    // =========================================================================
    // Step 3: Try to extract transcript
    // Check if transcript panel is already open, otherwise click the button
    // =========================================================================
    let segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    let needClose = false;

    if (segments.length === 0) {
      const btn = document.querySelector('ytd-video-description-transcript-section-renderer button');

      if (btn) {
        btn.click();
        needClose = true;

        // Wait for transcript to load (poll every 500ms)
        for (let i = 0; i < ${maxAttempts}; i++) {
          await new Promise(r => setTimeout(r, 500));
          segments = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (segments.length > 0) break;
        }
      }
    }

    // Helper to close the transcript panel (called in finally block)
    const closePanel = () => {
      if (needClose) {
        const closeBtn = document.querySelector(
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button'
        );
        if (closeBtn) closeBtn.click();
      }
    };

    // =========================================================================
    // Step 4: Extract transcript segments and return result
    // =========================================================================
    try {
      const transcript = [...segments].map(seg => ({
        timestamp: seg.querySelector('.segment-timestamp')?.textContent?.trim() || '',
        text: seg.querySelector('yt-formatted-string.segment-text, .segment-text')?.textContent?.trim() || ''
      })).filter(t => t.timestamp && t.text);

      return { videoId, title, channel, description, uploadDate, duration, genre, transcript };
    } finally {
      // Step 5: Always close the transcript panel if we opened it
      closePanel();
    }
  })()`;

  const result = await webview.executeJavaScript(code);

  // Validate result structure
  if (!isValidTranscriptResult(result)) {
    throw new Error("Invalid transcript data structure");
  }

  return result;
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
