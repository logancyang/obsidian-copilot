import { getYouTubeVideoId } from "@/utils/youtubeUrl";

export type UrlKind = "web" | "youtube";

export interface UrlItem {
  id: string;
  url: string;
  type: UrlKind;
}

function stableId(type: UrlKind, url: string): string {
  return `${type}:${url}`;
}

export function detectUrlType(url: string): UrlKind {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  return getYouTubeVideoId(normalized) !== null ? "youtube" : "web";
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

export function createUrlItem(raw: string): UrlItem {
  const url = normalizeUrl(raw);
  const type = detectUrlType(raw);
  return { id: stableId(type, url), url, type };
}

const CLOSING_TO_OPENING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const SENTENCE_PUNCTUATION_RE = /[.,;:!?，。！？；：、]/u;

function trimSentencePunctuationEnd(url: string, end: number): number {
  while (end > 0 && SENTENCE_PUNCTUATION_RE.test(url[end - 1])) end--;
  return end;
}

function trimUrlTrailingPunctuation(url: string): string {
  let end = trimSentencePunctuationEnd(url, url.length);
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
    if (closeCounts[last] <= openCounts[opener]) break;
    closeCounts[last]--;
    end = trimSentencePunctuationEnd(url, end - 1);
  }
  return url.slice(0, end);
}

export function extractUrlsFromText(text: string): string[] {
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

export function resolveInputUrls(text: string): string[] {
  const extracted = extractUrlsFromText(text);
  if (extracted.length > 0) return extracted;
  const single = text.trim();
  return single && !/\s/.test(single) && isValidUrl(single) ? [single] : [];
}

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

export function parseProjectUrls(webUrls: string, youtubeUrls: string): UrlItem[] {
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

  parseField(webUrls, "web");
  parseField(youtubeUrls, "youtube");

  return items;
}

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

export function isValidUrl(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  try {
    const url = new URL(
      normalized.startsWith("http://") || normalized.startsWith("https://")
        ? normalized
        : `https://${normalized}`
    );

    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    if (url.username) return false;

    const hostname = url.hostname.toLowerCase();
    if (!hostname) return false;

    if (hostname === "localhost") return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    if (hostname.startsWith("[") && hostname.endsWith("]")) return true;

    if (hostname.includes(".")) return true;

    return false;
  } catch {
    return false;
  }
}
