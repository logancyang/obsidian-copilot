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

export interface UrlItem {
  id: string;
  url: string;
  type: "web" | "youtube";
}

/**
 * Create a stable ID from type and URL.
 * Reason: Using random IDs causes React key instability when the list is
 * re-parsed from strings on every render. A deterministic ID based on
 * the URL content ensures stable keys and prevents unnecessary re-mounts.
 */
function stableId(type: "web" | "youtube", url: string): string {
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
export function detectUrlType(url: string): "web" | "youtube" {
  // Reason: User input may omit the protocol (e.g. "youtube.com/watch?v=...").
  // getYouTubeVideoId requires a full URL for `new URL()` parsing.
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  return getYouTubeVideoId(normalized) !== null ? "youtube" : "web";
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

  const parseField = (raw: string, type: "web" | "youtube") => {
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
