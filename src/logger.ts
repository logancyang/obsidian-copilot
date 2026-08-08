import { getSettings } from "@/settings/model";
import { logFileManager } from "@/logFileManager";

export function logInfo(...args: unknown[]) {
  if (getSettings().debug) {
    try {
      console.debug(...args);
    } catch {
      // Logging must never interrupt plugin work.
    }
  }
  // Always append to rolling file log
  void logFileManager.append("INFO", ...args);
}

export function logError(...args: unknown[]) {
  // Always include stack traces by default; console logs still respect debug
  if (getSettings().debug) {
    console.error(...args);
  }
  void logFileManager.append("ERROR", ...args);
}

export function logWarn(...args: unknown[]) {
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
 * Render structured rows in the dev console when debug is enabled.
 * Falls back to INFO logging when the console call fails.
 *
 * @param rows Structured records to display.
 * @param columns Optional ordered keys to include in the debug output.
 */
export function logTable(rows: Array<Record<string, unknown>>, columns?: string[]): void {
  if (getSettings().debug) {
    try {
      const output =
        Array.isArray(columns) && columns.length > 0
          ? rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])))
          : rows;
      console.debug(output);
      return;
    } catch {
      // ignore and fall back
    }
  }
  // Fallback: log compact JSON
  logInfo("Table:", JSON.stringify(rows));
}
