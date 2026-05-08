/**
 * Utility functions for localized messages
 */
import { t } from "@/lang";

/**
 * Loading message keys
 */
export type LoadingMessageKey = "DEFAULT" | "READING_FILES" | "SEARCHING_WEB" | "READING_FILE_TREE" | "COMPACTING";

/**
 * Get localized loading message
 */
export function getLoadingMessage(key: LoadingMessageKey): string {
  const keyMap: Record<LoadingMessageKey, string> = {
    DEFAULT: "loading.default",
    READING_FILES: "loading.readingFiles",
    SEARCHING_WEB: "loading.searchingWeb",
    READING_FILE_TREE: "loading.readingFileTree",
    COMPACTING: "loading.compacting",
  };

  return t(keyMap[key]);
}

/**
 * Get localized notice message with optional parameter interpolation
 */
export function getNoticeMessage(key: string, params?: Record<string, string | number>): string {
  return t(key, params);
}
