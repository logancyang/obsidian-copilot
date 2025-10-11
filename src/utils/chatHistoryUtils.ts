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
 * Get formatted display text for a chat file (title + formatted date).
 * Used in chat history modals and similar UI components.
 */
export function getChatDisplayText(file: TFile): string {
  const title = extractChatTitle(file);
  const date = extractChatDate(file);
  const formattedDateTime = formatDateTime(date);
  return `${title} - ${formattedDateTime.display}`;
}
