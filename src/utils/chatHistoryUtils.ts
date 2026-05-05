import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type { RecentUsageManager } from "@/utils/recentUsageManager";
import { formatDateTime } from "@/utils";
import { TFile } from "obsidian";

/**
 * Extract chat title from a file.
 * First checks frontmatter.topic, then extracts from filename by removing
 * project ID prefix, date/time patterns, and normalizing separators.
 */
export function extractChatTitle(file: TFile): string {
  // Read the file's front matter
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  // First check if there's a custom topic in frontmatter
  if (frontmatter?.topic && typeof frontmatter.topic === "string" && frontmatter.topic.trim()) {
    return frontmatter.topic.trim();
  }

  // Fallback to extracting from filename
  // First, remove project ID prefix if it exists (format: projectId__)
  const basename = file.basename.replace(/^[a-zA-Z0-9-]+__/, "");

  // Remove {$date} and {$time} parts from the filename
  return basename
    .replace(/\{\$date\}|\d{8}/g, "") // Remove {$date} or date in format YYYYMMDD
    .replace(/\{\$time\}|\d{6}/g, "") // Remove {$time} or time in format HHMMSS
    .replace(/[@_]/g, " ") // Replace @ and _ with spaces
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim();
}

/**
 * Extract chat creation date from a file.
 * Uses frontmatter.epoch if available, falls back to file creation time.
 */
export function extractChatDate(file: TFile): Date {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  if (frontmatter && frontmatter.epoch) {
    // Use the epoch from front matter if available
    return new Date(frontmatter.epoch);
  } else {
    // Fallback to file creation time if epoch is not in front matter
    return new Date(file.stat.ctime);
  }
}

/**
 * Extract chat last accessed time (epoch ms) from a file.
 * Uses frontmatter.lastAccessedAt if available, returns null otherwise.
 */
export function extractChatLastAccessedAtMs(file: TFile): number | null {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const rawValue = frontmatter?.lastAccessedAt;

  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    const parsedDate = Date.parse(rawValue);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
}

/**
 * Extract chat last accessed date from a file.
 * Uses extractChatLastAccessedAtMs and returns a Date when available, null otherwise.
 */
export function extractChatLastAccessedAt(file: TFile): Date | null {
  const lastAccessedAtMs = extractChatLastAccessedAtMs(file);
  return lastAccessedAtMs ? new Date(lastAccessedAtMs) : null;
}

/**
 * Build a `ChatHistoryItem` from a chat file, blending the in-memory
 * lastAccessedAt (for immediate UI feedback after a load/save) with the
 * persisted frontmatter value. Used by both the legacy and Agent Mode
 * chat-history flows so the two lists rank identically.
 */
export function fileToHistoryItem(
  file: TFile,
  lastAccessedAtManager: RecentUsageManager<string>
): ChatHistoryItem {
  const createdAt = extractChatDate(file);
  const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(file);
  const effectiveLastAccessedAtMs = lastAccessedAtManager.getEffectiveLastUsedAt(
    file.path,
    persistedLastAccessedAtMs ?? createdAt.getTime()
  );
  return {
    id: file.path,
    title: extractChatTitle(file),
    createdAt,
    lastAccessedAt: new Date(effectiveLastAccessedAtMs),
  };
}

/**
 * Get formatted display text for a chat file (title + formatted date).
 * Used in chat history modals and similar UI components.
 */
export function getChatDisplayText(file: TFile): string {
  const title = extractChatTitle(file);
  const date = extractChatDate(file);
  const formattedDateTime = formatDateTime(date);
  return `${title} - ${formattedDateTime.display}`;
}
