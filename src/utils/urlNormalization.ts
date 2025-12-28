import type { WebTabContext } from "@/types/message";

/**
 * URL Normalization Utilities
 *
 * Shared policy for URL normalization across ChatInput, ChatManager, and ContextProcessor.
 * Ensures consistent deduplication and comparison of web tab contexts.
 */

/**
 * Normalize a URL string for use in context and deduplication.
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
