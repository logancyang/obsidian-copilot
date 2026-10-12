export interface ProcessingItem {
  id: string;
  name: string;
  status: "pending" | "processing" | "ready" | "failed" | "unsupported";
  progress?: number;
  error?: string;
  contentEmpty?: boolean;
  cacheKind: "web" | "youtube";
}

export function processingItemEnvelope(
  cacheKind: ProcessingItem["cacheKind"],
  key: string
): Pick<ProcessingItem, "id" | "name" | "cacheKind"> {
  return { id: key, name: extractName(key), cacheKind };
}

function extractName(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) {
    try {
      const urlObj = new URL(key);
      const hostname = urlObj.hostname.replace("www.", "");
      const pathAndQuery = urlObj.pathname + urlObj.search;
      if (pathAndQuery && pathAndQuery !== "/") {
        const maxLen = 30;
        const shortPath =
          pathAndQuery.length > maxLen ? pathAndQuery.slice(0, maxLen) + "..." : pathAndQuery;
        return hostname + shortPath;
      }
      return hostname;
    } catch {
      return key.slice(0, 50);
    }
  }
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}
