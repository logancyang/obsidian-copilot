import type { WebTabContext } from "@/types/message";

/**
 * URL Normalization Utilities
 *
 * Shared policy for URL normalization across ChatInput, ChatManager, and ContextProcessor.
 * Ensures consistent deduplication and comparison of web tab contexts.
 */

/**
 * Normalize a URL string for use in context and deduplication.
 * Only trims whitespace - preserves hash, query params, etc.
 *
 * @param url - URL string to normalize
 * @returns Trimmed URL, or null if empty after trimming
 */
export function normalizeUrlString(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalize a URL for matching/deduplication purposes.
 * More aggressive normalization than normalizeUrlString:
 * - Removes hash fragments
 * - Removes default ports (:80 for http, :443 for https)
 * - Normalizes trailing slashes (removes except for root)
 * - Sorts query parameters for stable comparison
 *
 * Use this for URL comparison when determining if two URLs point to the same page.
 *
 * Note: For invalid URLs that cannot be parsed, returns the trimmed string as fallback.
 *
 * @param url - URL string to normalize
 * @returns Normalized URL for matching, null if empty/null/undefined, or trimmed string if URL parsing fails
 */
export function normalizeUrlForMatching(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";

    // Remove default ports
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }

    // Normalize trailing slashes (remove except for root path)
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    // Sort query parameters for stable comparison
    const entries = Array.from(parsed.searchParams.entries());
    if (entries.length > 0) {
      entries.sort(([aKey, aValue], [bKey, bValue]) => {
        if (aKey !== bKey) return aKey.localeCompare(bKey);
        return aValue.localeCompare(bValue);
      });
      parsed.search = `?${new URLSearchParams(entries).toString()}`;
    } else {
      parsed.search = "";
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return trimmed string as fallback
    return trimmed;
  }
}

/**
 * Normalize an optional metadata string (title/faviconUrl) by trimming and dropping empties.
 *
 * @param value - Raw string value
 * @returns Trimmed string, or undefined if empty after trimming
 */
export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = normalizeUrlString(value);
  return normalized ?? undefined;
}

/**
 * Normalize a WebTabContext object for stable storage, comparisons, and deduplication.
 *
 * @param tab - Web tab context
 * @returns Normalized web tab context, or null if URL is empty/invalid
 */
export function normalizeWebTabContext(tab: WebTabContext): WebTabContext | null {
  const url = normalizeUrlString(tab.url);
  if (!url) return null;

  const title = normalizeOptionalString(tab.title);
  const faviconUrl = normalizeOptionalString(tab.faviconUrl);

  return {
    url,
    title,
    faviconUrl,
    isLoaded: tab.isLoaded,
    isActive: tab.isActive ? true : undefined,
  };
}

/**
 * Merge and deduplicate WebTabContext entries by normalized URL.
 *
 * Merge policy:
 * - Preserves insertion order of the first occurrence of each URL
 * - Later entries fill/override missing metadata (title/favicon/isLoaded)
 * - isActive becomes true if any merged entry is active
 *
 * @param tabs - Input web tab contexts
 * @returns Deduplicated, merged list
 */
export function mergeWebTabContexts(tabs: WebTabContext[]): WebTabContext[] {
  const byUrl = new Map<string, WebTabContext>();

  for (const tab of tabs) {
    const normalized = normalizeWebTabContext(tab);
    if (!normalized) continue;

    const existing = byUrl.get(normalized.url);
    if (!existing) {
      byUrl.set(normalized.url, normalized);
      continue;
    }

    byUrl.set(normalized.url, {
      ...existing,
      title: normalized.title ?? existing.title,
      faviconUrl: normalized.faviconUrl ?? existing.faviconUrl,
      isLoaded: normalized.isLoaded ?? existing.isLoaded,
      isActive: existing.isActive || normalized.isActive ? true : undefined,
    });
  }

  return Array.from(byUrl.values());
}

/**
 * Sanitize a webTabs array:
 * - Normalize and deduplicate by URL
 * - Ensure at most one tab has isActive=true
 *
 * @param tabs - Input web tab contexts
 * @returns Sanitized web tab contexts
 */
export function sanitizeWebTabContexts(tabs: WebTabContext[]): WebTabContext[] {
  const merged = mergeWebTabContexts(tabs);

  let hasActive = false;
  return merged.map((tab) => {
    if (!tab.isActive) return tab;
    if (!hasActive) {
      hasActive = true;
      return tab;
    }

    // Remove duplicate isActive flags
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isActive: _unused, ...rest } = tab;
    return rest;
  });
}
