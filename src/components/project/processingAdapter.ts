import { detectUrlType } from "@/utils/urlTagUtils";

export interface ProcessingItem {
  id: string;
  name: string;
  source: "file" | "url";
  fileType: "pdf" | "image" | "web" | "youtube" | "audio" | "other";
  status: "pending" | "processing" | "ready" | "failed" | "unsupported";
  progress?: number;
  error?: string;
  contentEmpty?: boolean;
  cacheKind: "file" | "web" | "youtube";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff"]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "mp4",
  "mpeg",
  "mpga",
  "webm",
]);

function inferFileType(path: string): ProcessingItem["fileType"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "other";
}

function inferUrlFileType(url: string): ProcessingItem["fileType"] {
  return detectUrlType(url);
}

export function processingItemEnvelope(
  cacheKind: ProcessingItem["cacheKind"],
  key: string
): Pick<ProcessingItem, "id" | "name" | "source" | "fileType" | "cacheKind"> {
  const fileType =
    cacheKind === "file"
      ? inferFileType(key)
      : cacheKind === "youtube"
        ? "youtube"
        : inferUrlFileType(key);
  return {
    id: key,
    name: extractName(key),
    source: cacheKind === "file" ? "file" : "url",
    fileType,
    cacheKind,
  };
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
