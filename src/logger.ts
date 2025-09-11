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
