/**
 * Adapter that bridges project context load state and project cache into the
 * ProcessingItem[] model used by the ProcessingStatus component.
 *
 * Reason: The ProcessingStatus UI expects a flat array of ProcessingItem objects.
 * Our system stores context load state as four separate arrays (total, success,
 * failed, processingFiles) and a persistent ContextCache for non-active projects.
 * This adapter translates both into a unified view while:
 *  - Filtering markdown files (they don't need conversion)
 *  - Supporting cache-fallback status for non-current projects
 *  - Detecting empty URL/YouTube content (contentEmpty flag)
 *  - Marking unsupported file extensions explicitly
 */

import type { FailedItem, ProjectConfig } from "@/aiParams";
import type { ContextCache } from "@/cache/projectContextCache";
import { detectUrlType } from "@/utils/urlTagUtils";
import type { TFile } from "obsidian";

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

export interface ProcessingAdapterResult {
  items: ProcessingItem[];
  /** Maps ProcessingItem.id → original FailedItem for retry calls */
  failedItemMap: Map<string, FailedItem>;
}

/**
 * Live state snapshot from useProjectContextLoad().
 * Represents the current processing session for the active project.
 */
interface ContextLoadState {
  total: string[];
  success: string[];
  failed: FailedItem[];
  processingFiles: string[];
}

/**
 * Options for building the processing items list.
 * Callers supply all needed context so this function remains pure and testable.
 */
export interface BuildProcessingItemsOptions {
  /** The project whose items are being displayed. */
  project: ProjectConfig;
  /** True if this project is the currently active/loaded project. */
  isCurrentProject: boolean;
  /** Live processing state (from useProjectContextLoad). */
  liveState: ContextLoadState;
  /** Persistent context cache for this project (null = no cache, undefined = still loading). */
  projectCache: ContextCache | null | undefined;
  /** All vault files that match this project's inclusion patterns. */
  projectFiles: TFile[];
  /** Extensions supported in project mode (from FileParserManager.getProjectSupportedExtensions). */
  supportedExtensions: Set<string>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "mp4", "mpeg", "mpga", "webm"]);

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
        const shortPath = pathAndQuery.length > maxLen ? pathAndQuery.slice(0, maxLen) + "..." : pathAndQuery;
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

/**
 * Parse raw newline-separated URL config strings into a deduplicated array.
 * Returns only non-empty trimmed lines.
 */
function parseUrlConfig(raw?: string): string[] {
  if (!raw) return [];
  // Reason: Deduplicate to prevent duplicate React keys and duplicate status rows
  return [...new Set(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  )];
}

/**
 * Determine the status of a single key (file path or URL) for the CURRENT active project.
 * Priority order: processing > failed > ready > pending.
 */
function resolveCurrentProjectStatus(
  key: string,
  processingSet: Set<string>,
  failedByPath: Map<string, FailedItem>,
  successSet: Set<string>
): { status: ProcessingItem["status"]; error?: string; failedItem?: FailedItem } {
  if (processingSet.has(key)) {
    return { status: "processing" };
  }
  if (failedByPath.has(key)) {
    const failedItem = failedByPath.get(key)!;
    return { status: "failed", error: failedItem.error, failedItem };
  }
  if (successSet.has(key)) {
    return { status: "ready" };
  }
  return { status: "pending" };
}

/**
 * Determine if a "ready" URL item has no extractable content.
 *
 * Reason: Empty fetch results are NOT stored in the cache (projectManager.ts only
 * writes to webContexts/youtubeContexts when content is truthy). So if a URL is
 * in the success set but absent from the cache, it was fetched but yielded nothing.
 * This check is only valid for the current active project where we have liveState.
 *
 * Reason: We use cacheField (which cache dict to check) instead of fileType, because
 * a YouTube URL in webUrls is stored in webContexts by projectManager, not youtubeContexts.
 */
function detectContentEmpty(
  url: string,
  cacheField: "web" | "youtube",
  projectCache: ContextCache | null | undefined
): boolean {
  if (!projectCache) return false;
  if (cacheField === "youtube") {
    const content = projectCache.youtubeContexts?.[url];
    return !content || content.trim().length === 0;
  }
  // "web" type
  const content = projectCache.webContexts?.[url];
  return !content || content.trim().length === 0;
}

/**
 * Determine the status of a single key for a NON-CURRENT project using cache data only.
 *
 * Logic (mirrors ContextManageModal.getProjectContextItemStatus):
 *  - File path: present in fileContexts with a cacheKey → "ready", else "pending"
 *  - Web URL: present in webContexts with non-empty content → "ready", else "pending"
 *  - YouTube URL: present in youtubeContexts with non-empty content → "ready", else "pending"
 *
 * Reason: cacheField determines which cache dict to check. This is based on which
 * config field the URL came from, NOT the inferred fileType, because projectManager
 * stores results by config field (webUrls → webContexts, youtubeUrls → youtubeContexts).
 */
function resolveNonCurrentProjectStatus(
  key: string,
  isUrl: boolean,
  cacheField: "web" | "youtube" | null,
  cache: ContextCache | null | undefined
): ProcessingItem["status"] {
  if (!cache) return "pending";

  if (isUrl && cacheField) {
    if (cacheField === "youtube") {
      const content = cache.youtubeContexts?.[key];
      return content && content.trim().length > 0 ? "ready" : "pending";
    }
    // web URL
    const content = cache.webContexts?.[key];
    return content && content.trim().length > 0 ? "ready" : "pending";
  }

  // File path: check fileContexts for a valid cacheKey
  const entry = cache.fileContexts?.[key];
  return entry?.cacheKey ? "ready" : "pending";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the flat ProcessingItem list for the ProcessingStatus component.
 *
 * Candidate enumeration:
 *  - Non-markdown files from projectFiles (vault files matching project patterns)
 *  - URLs from project.contextSource.webUrls and .youtubeUrls
 *
 * This avoids depending on liveState.total which may be stale or empty for
 * non-current projects.
 */
export function buildProcessingItems(options: BuildProcessingItemsOptions): ProcessingAdapterResult {
  const {
    project,
    isCurrentProject,
    liveState,
    projectCache,
    projectFiles,
    supportedExtensions,
  } = options;

  // Pre-process live state sets for O(1) lookups
  const successSet = new Set(liveState.success);
  const processingSet = new Set(liveState.processingFiles);
  const failedByPath = new Map<string, FailedItem>();
  for (const item of liveState.failed) {
    failedByPath.set(item.path, item);
  }

  const items: ProcessingItem[] = [];
  const failedItemMap = new Map<string, FailedItem>();
  // Reason: Track seen IDs to prevent duplicate rows when the same URL appears
  // in both webUrls and youtubeUrls config fields.
  const seenIds = new Set<string>();

  // -------------------------------------------------------------------------
  // 1. Non-markdown vault files
  // -------------------------------------------------------------------------
  for (const file of projectFiles) {
    // Reason: Only .md files are handled by the markdown context pipeline.
    // .markdown files go through processNonMarkdownFiles and should appear in the panel.
    if (file.extension === "md") continue;

    const key = file.path;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    const ext = file.extension.toLowerCase();

    // Files with unsupported extensions will never be processed in project mode.
    // Reason: Show "unsupported" rather than leaving them forever as "pending",
    // which looks like a stalled queue to the user.
    if (!supportedExtensions.has(ext)) {
      items.push({
        id: key,
        name: extractName(key),
        source: "file",
        fileType: inferFileType(key),
        status: "unsupported",
        cacheKind: "file",
      });
      continue;
    }

    let status: ProcessingItem["status"];
    let error: string | undefined;

    if (isCurrentProject) {
      const resolved = resolveCurrentProjectStatus(key, processingSet, failedByPath, successSet);
      status = resolved.status;
      error = resolved.error;
      if (resolved.failedItem) {
        failedItemMap.set(key, resolved.failedItem);
      }
    } else {
      status = resolveNonCurrentProjectStatus(key, false, null, projectCache);
    }

    items.push({
      id: key,
      name: extractName(key),
      source: "file",
      fileType: inferFileType(key),
      status,
      error,
      cacheKind: "file",
    });
  }

  // -------------------------------------------------------------------------
  // 2. Web URLs
  // -------------------------------------------------------------------------
  for (const url of parseUrlConfig(project.contextSource?.webUrls)) {
    if (seenIds.has(url)) continue;
    seenIds.add(url);
    const fileType = inferUrlFileType(url);
    let status: ProcessingItem["status"];
    let error: string | undefined;
    let contentEmpty: boolean | undefined;

    if (isCurrentProject) {
      const resolved = resolveCurrentProjectStatus(url, processingSet, failedByPath, successSet);
      status = resolved.status;
      error = resolved.error;
      if (resolved.failedItem) {
        failedItemMap.set(url, resolved.failedItem);
      }
      // Detect empty-content fetch only when status is ready (URL was processed)
      if (status === "ready") {
        contentEmpty = detectContentEmpty(url, "web", projectCache) || undefined;
      }
    } else {
      status = resolveNonCurrentProjectStatus(url, true, "web", projectCache);
    }

    items.push({
      id: url,
      name: extractName(url),
      source: "url",
      fileType,
      status,
      error,
      contentEmpty,
      cacheKind: "web",
    });
  }

  // -------------------------------------------------------------------------
  // 3. YouTube URLs
  // -------------------------------------------------------------------------
  for (const url of parseUrlConfig(project.contextSource?.youtubeUrls)) {
    if (seenIds.has(url)) continue;
    seenIds.add(url);
    const fileType: ProcessingItem["fileType"] = "youtube";
    let status: ProcessingItem["status"];
    let error: string | undefined;
    let contentEmpty: boolean | undefined;

    if (isCurrentProject) {
      const resolved = resolveCurrentProjectStatus(url, processingSet, failedByPath, successSet);
      status = resolved.status;
      error = resolved.error;
      if (resolved.failedItem) {
        failedItemMap.set(url, resolved.failedItem);
      }
      if (status === "ready") {
        contentEmpty = detectContentEmpty(url, "youtube", projectCache) || undefined;
      }
    } else {
      status = resolveNonCurrentProjectStatus(url, true, "youtube", projectCache);
    }

    items.push({
      id: url,
      name: extractName(url),
      source: "url",
      fileType,
      status,
      error,
      contentEmpty,
      cacheKind: "youtube",
    });
  }

  // Non-current projects have no live failed state to surface for retry.
  // Reason: We only have cache data for non-current projects, not error details.
  return { items, failedItemMap: isCurrentProject ? failedItemMap : new Map() };
}
