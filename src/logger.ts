import { getSettings } from "@/settings/model";
import { logFileManager } from "@/logFileManager";

export function logInfo(...args: unknown[]) {
  if (getSettings().debug) {
    // Obsidian's plugin review allows only warn, error, and debug on the console, so
    // info-level output ships as console.debug. Chromium files that under "Verbose".
    // eslint-disable-next-line no-restricted-syntax -- logInfo is the approved console boundary.
    console.debug(...args);
  }
  // Always append to rolling file log
  void logFileManager.append("INFO", ...args);
}

export function logError(...args: unknown[]) {
  // Always include stack traces by default; console logs still respect debug
  if (getSettings().debug) {
    // eslint-disable-next-line no-restricted-syntax -- logError is the approved console.error boundary.
    console.error(...args);
  }
  void logFileManager.append("ERROR", ...args);
}

export function logWarn(...args: unknown[]) {
  if (getSettings().debug) {
    // eslint-disable-next-line no-restricted-syntax -- logWarn is the approved console.warn boundary.
    console.warn(...args);
  }
  void logFileManager.append("WARN", ...args);
}

/**
 * Append a raw Markdown block to the log file (no timestamps, preserves line starts).
 * This is intended for structures like tables that must start with '|' or '<table>'.
 */
export function logMarkdownBlock(lines: string[]): void {
  void logFileManager.appendMarkdownBlock(lines);
}
