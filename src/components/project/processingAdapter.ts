/**
 * Shared shape of a single context source row in the ProcessingStatus UI, plus
 * the pure helpers that derive a row's display fields from its source identity.
 *
 * The status of each row is resolved by the pipeline that owns it (see
 * `agentProcessingAdapter`), so this module stays free of any pipeline state.
 */

import { detectUrlType } from "@/utils/urlTagUtils";

export interface ProcessingItem {
  id: string;
  name: string;
  source: "file" | "url";
  fileType: "pdf" | "image" | "web" | "youtube" | "audio" | "other";
  /**
   * "unsupported" means the file extension is not handled by the project-mode parser
   * and will never be processed. "pending" means it will be processed eventually.
   */
  status: "pending" | "processing" | "ready" | "failed" | "unsupported";
  progress?: number;
  error?: string;
  /**
   * True when a URL was successfully fetched but returned no extractable content.
   * Only set for the current active project (non-current projects cannot distinguish
   * "never fetched" from "fetched but empty" since empty results aren't cached).
   */
  contentEmpty?: boolean;
  /**
   * Which cache bucket holds this item's parsed content.
   * Determined by config source field, not by inferred fileType.
   * - "file" → fileContexts (content on disk via cacheKey)
   * - "web" → webContexts (string in memory)
   * - "youtube" → youtubeContexts (string in memory)
   */
  cacheKind: "file" | "web" | "youtube";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/** Infer file type from a file path's extension. */
function inferFileType(path: string): ProcessingItem["fileType"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "other";
}

/** Infer file type for a URL by reusing the shared YouTube detection in urlTagUtils. */
function inferUrlFileType(url: string): ProcessingItem["fileType"] {
  return detectUrlType(url);
}

/**
 * Build the display envelope of a {@link ProcessingItem} — everything derivable
 * from the source identity alone (`id`, `name`, `source`, `fileType`). Status,
 * error, and contentEmpty are resolved separately by each pipeline and spread
 * on top by the caller. Shared by the CAG adapter and the agent adapter so the
 * two stay structurally identical; only their status resolution differs.
 *
 * `cacheKind` is the source's storage bucket; for a "web" kind the URL is still
 * re-sniffed (a YouTube link pasted into the web list renders as a video).
 */
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

/** Extract a human-readable name from a file path or URL. */
function extractName(key: string): string {
  // Reason: URLs should show domain + path + query; file paths should show just the filename.
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
