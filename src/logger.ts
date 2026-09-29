import { getSettings } from "@/settings/model";
import { logFileManager } from "@/logFileManager";

export function logInfo(...args: unknown[]) {
  if (getSettings().debug) {
    // eslint-disable-next-line no-restricted-syntax -- logInfo is the approved console boundary.
    console.debug(...args);
  }
  void logFileManager.append("INFO", ...args);
}

export function logError(...args: unknown[]) {
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

export function logMarkdownBlock(lines: string[]): void {
  void logFileManager.appendMarkdownBlock(lines);
}
