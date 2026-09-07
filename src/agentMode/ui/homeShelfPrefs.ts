/**
 * Device-local UI preferences for the Agent Home shelf, persisted via
 * Obsidian's vault-scoped `App.loadLocalStorage` / `App.saveLocalStorage`
 * (which never sync).
 *
 * These are intentionally device-local: the shelf tab you last viewed is
 * per-device UI state, not content that should ride a synced `data.json`
 * to your other devices.
 *
 * Storage failures are non-fatal: reads return a safe default and writes are
 * ignored so unavailable storage cannot crash the UI.
 */

import { logWarn } from "@/logger";
import type { App } from "obsidian";

export const HOME_SHELF_TAB_STORAGE_KEY = "copilot:home-shelf-tab:v1";

/**
 * Read a vault-scoped preference, or return `null` when unset or storage is unusable.
 */
function loadPref(app: App, key: string): string | null {
  try {
    const value = app.loadLocalStorage(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Read the last-selected shelf tab id, or `null` when unset or storage is unusable. */
export function getHomeShelfTab(app: App, storageKey: string): string | null {
  return loadPref(app, storageKey);
}

/** Persist the selected shelf tab id; no-op if storage is unusable. */
export function setHomeShelfTab(app: App, storageKey: string, id: string): void {
  try {
    app.saveLocalStorage(storageKey, id);
  } catch (e) {
    logWarn("Failed to persist home shelf tab", e);
  }
}
