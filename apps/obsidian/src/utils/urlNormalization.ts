import type { WebTabContext } from "@/types/message";

export function normalizeUrlString(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return trimmed ? trimmed : null;
}

export function normalizeUrlForMatching(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";

    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }

    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

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
    return trimmed;
  }
}

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = normalizeUrlString(value);
  return normalized ?? undefined;
}

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

export function sanitizeWebTabContexts(tabs: WebTabContext[]): WebTabContext[] {
  const merged = mergeWebTabContexts(tabs);

  let hasActive = false;
  return merged.map((tab) => {
    if (!tab.isActive) return tab;
    if (!hasActive) {
      hasActive = true;
      return tab;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- invalid URLs fall back to the original input
    const { isActive: _unused, ...rest } = tab;
    return rest;
  });
}
