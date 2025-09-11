import { getSettings } from "@/settings/model";
import { logFileManager } from "@/logFileManager";

export function logInfo(...args: any[]) {
  if (getSettings().debug) {
    console.log(...args);
  }
  // Always append to rolling file log
  void logFileManager.append("INFO", ...args);
}

export function logError(...args: any[]) {
  // Always include stack traces by default; console logs still respect debug
  if (getSettings().debug) {
    console.error(...args);
  }
  void logFileManager.append("ERROR", ...args);
}

export function logWarn(...args: any[]) {
  if (getSettings().debug) {
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

/**
 * Render a table in the dev console when debug is enabled.
 * Falls back to INFO log when console.table is unavailable.
 */
export function logTable(rows: Array<Record<string, unknown>>, columns?: string[]): void {
  if (getSettings().debug) {
    try {
      // @ts-ignore - console.table exists in Chromium runtime
      if (typeof console.table === "function") {
        // Provide columns if specified to control field order
        if (Array.isArray(columns) && columns.length > 0) {
          // @ts-ignore
          console.table(rows, columns);
        } else {
          // @ts-ignore
          console.table(rows);
        }
        return;
      }
    } catch {
      // ignore and fall back
    }
  }
  // Fallback: log compact JSON
  logInfo("Table:", JSON.stringify(rows));
}
