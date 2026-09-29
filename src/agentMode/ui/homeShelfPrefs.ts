import { logWarn } from "@/logger";
import type { App } from "obsidian";

export const HOME_SHELF_TAB_STORAGE_KEY = "copilot:home-shelf-tab:v1";

function loadPref(app: App, key: string): string | null {
  try {
    const value = app.loadLocalStorage(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function getHomeShelfTab(app: App, storageKey: string): string | null {
  return loadPref(app, storageKey);
}

export function setHomeShelfTab(app: App, storageKey: string, id: string): void {
  try {
    app.saveLocalStorage(storageKey, id);
  } catch (e) {
    logWarn("Failed to persist home shelf tab", e);
  }
}
