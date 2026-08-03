/**
 * Pure utility functions for converting between ProjectConfig's newline-separated
 * URL strings and the UrlItem[] model used by UrlTagInput.
 *
 * Reason: The UrlTagInput component works with structured UrlItem objects,
 * but ProjectConfig stores URLs as newline-separated strings in two separate
 * fields (webUrls / youtubeUrls). This module bridges those two representations
 * with stable round-trip guarantees so saving unchanged URLs won't trigger
 * unnecessary cache invalidation in projectManager.
 */

import { getYouTubeVideoId } from "@/utils/youtubeUrl";

/**
 * The two kinds a context URL can be classified as. Single source of truth —
 * every URL surface (input, icon, status, cache remote) derives from this so a
 * new kind is added in one place.
 */
export type UrlKind = "web" | "youtube";

export interface UrlItem {
  id: string;
  url: string;
  type: UrlKind;
}

/**
 * Create a stable ID from type and URL.
 * Reason: Using random IDs causes React key instability when the list is
 * re-parsed from strings on every render. A deterministic ID based on
 * the URL content ensures stable keys and prevents unnecessary re-mounts.
 */
function stableId(type: UrlKind, url: string): string {
  return `${type}:${url}`;
}

/**
 * Detect whether a URL is a YouTube video (watch/shorts/embed/youtu.be).
 *
 * Reason: Reuses the structured URL parser `getYouTubeVideoId` from `@/utils/youtubeUrl`
 * instead of a loose hostname check, so only actual video URLs are classified as
 * "youtube". Non-video YouTube pages (channels, playlists, homepage) correctly
 * fall through to "web", matching the downstream transcript pipeline expectation.
 */
export function detectUrlType(url: string): UrlKind {
  // Reason: User input may omit the protocol (e.g. "youtube.com/watch?v=...").
  // getYouTubeVideoId requires a full URL for `new URL()` parsing.
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  return getYouTubeVideoId(normalized) !== null ? "youtube" : "web";
}

/**
 * Add the `https://` scheme when the user typed a bare host (e.g. "example.com").
 * Reason: callers store and dedup URLs in normalized form so the same address
 * typed with/without a scheme collapses to one entry.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

/**
 * Build a {@link UrlItem} from a raw (possibly scheme-less) URL string, using the
 * same stable id scheme as {@link parseProjectUrls} so a value keeps one identity
 * whether it was just typed or re-parsed from the persisted strings.
 */
export function createUrlItem(raw: string): UrlItem {
  const url = normalizeUrl(raw);
  const type = detectUrlType(raw);
  return { id: stableId(type, url), url, type };
}

const CLOSING_TO_OPENING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const SENTENCE_PUNCTUATION_RE = /[.,;:!?，。！？；：、]/u;

/** Walk back over trailing sentence/CJK punctuation in `url[0, end)`, returning the new end. */
function trimSentencePunctuationEnd(url: string, end: number): number {
  while (end > 0 && SENTENCE_PUNCTUATION_RE.test(url[end - 1])) end--;
  return end;
}

/**
 * Trim trailing punctuation a URL accretes from the prose around it — sentence
 * enders and CJK punctuation — plus an UNBALANCED closing bracket, so
 * "(see https://x.com)" yields "https://x.com" while a path that legitimately
 * ends in a balanced bracket (e.g. Wikipedia ".../Foo_(disambiguation)") keeps it.
 */
function trimUrlTrailingPunctuation(url: string): string {
  let end = trimSentencePunctuationEnd(url, url.length);
  // Count brackets once so the trailing-strip loop stays O(n). Re-splitting the
  // whole string per stripped char is O(n²) and freezes the main thread on a
  // pathological trailing-bracket run (e.g. a corrupted paste). Only closers and
  // sentence punctuation are ever stripped — never openers — so these opener
  // totals stay valid as `end` walks left.
  const openCounts: Record<string, number> = { "(": 0, "[": 0, "{": 0 };
  const closeCounts: Record<string, number> = { ")": 0, "]": 0, "}": 0 };
  for (let i = 0; i < end; i++) {
    const ch = url[i];
    if (ch === "(" || ch === "[" || ch === "{") openCounts[ch]++;
    else if (ch === ")" || ch === "]" || ch === "}") closeCounts[ch]++;
  }
  while (end > 0) {
    const last = url[end - 1];
    const opener = CLOSING_TO_OPENING[last];
    if (!opener) break;
    if (closeCounts[last] <= openCounts[opener]) break; // balanced — keep it
    closeCounts[last]--;
    // Re-trim sentence punctuation the bracket was hiding ("example.com.)").
    end = trimSentencePunctuationEnd(url, end - 1);
  }
  return url.slice(0, end);
}

/**
 * Extract http(s) URLs from free-form text. Scheme-anchored on purpose: a bare
 * dotted token in prose ("1.", "(context.urls)", or a CJK sentence whose `。`
 * IDNA-folds to a dot) is NOT a URL — and since a legit bare host like
 * "example.com" is structurally indistinguishable from those, requiring an
 * explicit http(s):// scheme is the only robust lever against false positives
 * when a whole document is pasted. Trailing prose punctuation is trimmed and the
 * result de-duplicated. This is the canonical extractor — `Mention.extractUrls`
 * (the @-mention pipeline) and {@link parseUrlsFromText} both route through it.
 */
export function extractUrlsFromText(text: string): string[] {
  // Stop the match at whitespace, quotes, angle brackets, and CJK/full-width
  // punctuation — the last so a URL written flush against Chinese prose
  // ("链接https://x.com，谢谢") doesn't swallow the trailing sentence.
  const urlRegex = /https?:\/\/[^\s"'<>，。、！？；：）（【】「」『』《》]+/g;
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of text.match(urlRegex) ?? []) {
    const url = trimUrlTrailingPunctuation(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/**
 * Resolve free-form text to the URL strings a user meant to add: every
 * scheme-anchored URL via {@link extractUrlsFromText}, OR — when the text is a
 * single bare token with no scheme (e.g. "youtube.com/watch?v=x") — that one
 * host. The single-token fallback keeps the convenience of typing one URL
 * without a scheme, while a pasted blob (which has whitespace) never triggers it,
 * so prose can't smuggle bare-host garbage in.
 */
export function resolveInputUrls(text: string): string[] {
  const extracted = extractUrlsFromText(text);
  if (extracted.length > 0) return extracted;
  const single = text.trim();
  return single && !/\s/.test(single) && isValidUrl(single) ? [single] : [];
}

/**
 * Parse free-form text (single URL, or batch paste) into deduplicated
 * {@link UrlItem}s. `existingUrls` (raw or normalized) are excluded so re-adding
 * a URL already in the list is a no-op. Dedup is by normalized URL. Shared by
 * {@link UrlTagInput}, the home/Manage `+URL` flows, and the project URL field,
 * so all classify and normalize input identically.
 */
export function parseUrlsFromText(text: string, existingUrls: string[] = []): UrlItem[] {
  const seen = new Set(existingUrls.map(normalizeUrl));
  const items: UrlItem[] = [];
  for (const raw of resolveInputUrls(text)) {
    const item = createUrlItem(raw);
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
  return items;
}

/**
 * Parse ProjectConfig's webUrls + youtubeUrls newline strings into UrlItem[].
 *
 * Web items come first (preserving order), then YouTube items (preserving order).
 * Duplicates within the same field are removed (first occurrence wins).
 */
export function parseProjectUrls(webUrls: string, youtubeUrls: string): UrlItem[] {
  // Reason: Dedup by (type, url) pair so the same URL in both webUrls and youtubeUrls
  // is preserved for each field independently — prevents silent data loss on round-trip.
  const seen = new Set<string>();
  const items: UrlItem[] = [];

  const parseField = (raw: string, type: UrlKind) => {
    if (!raw) return;
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const key = stableId(type, trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: key, url: trimmed, type });
    }
  };

  // Reason: Web first, then YouTube — matches the visual grouping order in UrlTagInput
  parseField(webUrls, "web");
  parseField(youtubeUrls, "youtube");

  return items;
}

/**
 * Serialize UrlItem[] back to the two newline-separated strings that
 * ProjectConfig expects.
 *
 * Preserves item order within each type. Trims and deduplicates.
 * Produces stable output so unchanged URLs produce identical strings.
 */
export function serializeProjectUrls(items: UrlItem[]): {
  webUrls: string;
  youtubeUrls: string;
} {
  const webSeen = new Set<string>();
  const youtubeSeen = new Set<string>();
  const webLines: string[] = [];
  const youtubeLines: string[] = [];

  for (const item of items) {
    const trimmed = item.url.trim();
    if (!trimmed) continue;

    if (item.type === "youtube") {
      if (youtubeSeen.has(trimmed)) continue;
      youtubeSeen.add(trimmed);
      youtubeLines.push(trimmed);
    } else {
      if (webSeen.has(trimmed)) continue;
      webSeen.add(trimmed);
      webLines.push(trimmed);
    }
  }

  return {
    webUrls: webLines.join("\n"),
    youtubeUrls: youtubeLines.join("\n"),
  };
}

/**
 * Check whether a string looks like a real URL.
 * Reason: The old Textarea didn't validate — users typed raw text.
 * The new UrlTagInput actively parses, splits, and normalizes input,
 * so this function is the behavioral gate. A loose check like `includes(".")`
 * would silently convert "e.g.", "v1.2.3", or filenames into URLs.
 */
export function isValidUrl(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  try {
    const url = new URL(
      normalized.startsWith("http://") || normalized.startsWith("https://")
        ? normalized
        : `https://${normalized}`
    );

    // Reason: only http/https are valid project context URLs
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    // Reason: reject email-like inputs (user@host) and mailto: URIs that the
    // URL constructor parses as authority-form URLs with a username component.
    if (url.username) return false;

    const hostname = url.hostname.toLowerCase();
    if (!hostname) return false;

    // Reason: localhost, IPv4, and IPv6 are valid hosts that the old textarea accepted
    if (hostname === "localhost") return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    if (hostname.startsWith("[") && hostname.endsWith("]")) return true;

    // Reason: any dotted hostname is accepted (e.g. youtu.be, example.com).
    // Bare single-label words like "foo" are still rejected so Enter/paste
    // doesn't silently convert arbitrary text into URLs.
    if (hostname.includes(".")) return true;

    return false;
  } catch {
    return false;
  }
}
