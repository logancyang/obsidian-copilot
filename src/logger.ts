import { getSettings } from "@/settings/model";

export function logInfo(...args: any[]) {
  if (getSettings().debug) {
    console.log(...args);
  }
}

export function logError(...args: any[]) {
  if (getSettings().debug) {
    console.error(...args);
  }
}

export function logWarn(...args: any[]) {
  if (getSettings().debug) {
    console.warn(...args);
  }
}
