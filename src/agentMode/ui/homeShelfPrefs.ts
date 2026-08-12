/**
 * Device-local UI preferences for the Agent Home shelf, persisted via
 * Obsidian's vault-scoped `App.loadLocalStorage` / `App.saveLocalStorage`
 * (which never sync). Mirrors the storage idiom in `deviceId.ts`: every access
 * is wrapped in try/catch, reads return a safe default on failure, and writes
 * swallow errors so a broken-storage device (disabled / restricted) never
 * crashes the UI — it just loses persistence. On first read each value is
 * seeded from the legacy raw `localStorage` key older releases wrote; the
 * legacy key is left in place for vaults that have not migrated yet.
 *
 * These are intentionally device-local: which shelf tab you last viewed and
 * whether you dismissed the pop-out hint are per-device UI state, not content
 * that should ride a synced `data.json` to your other devices.
 */

import { logWarn } from "@/logger";
import { readLegacyLocalStorage } from "@/utils/legacyLocalStorage";
import type { App } from "obsidian";

export const HOME_SHELF_TAB_STORAGE_KEY = "copilot:home-shelf-tab:v1";
const POPOUT_HINT_DISMISSED_KEY = "copilot:relevant-notes-popout-hint-dismissed:v1";

/**
 * Read a vault-scoped preference, migrating the legacy raw-localStorage value
 * forward on first read. Returns `null` when unset or storage is unusable.
 */
function loadPrefWithLegacyFallback(app: App, key: string): string | null {
  try {
    const value = app.loadLocalStorage(key);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    const legacy = readLegacyLocalStorage(key);
    if (legacy && legacy.length > 0) {
      app.saveLocalStorage(key, legacy);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the last-selected shelf tab id, or `null` when unset or storage is unusable. */
export function getHomeShelfTab(app: App, storageKey: string): string | null {
  return loadPrefWithLegacyFallback(app, storageKey);
}

/** Persist the selected shelf tab id; no-op if storage is unusable. */
export function setHomeShelfTab(app: App, storageKey: string, id: string): void {
  try {
    app.saveLocalStorage(storageKey, id);
  } catch (e) {
    logWarn("Failed to persist home shelf tab", e);
  }
}

/** Whether the user dismissed the Relevant Notes pop-out hint; defaults to false. */
export function isPopOutHintDismissed(app: App): boolean {
  return loadPrefWithLegacyFallback(app, POPOUT_HINT_DISMISSED_KEY) === "true";
}

/** Mark the Relevant Notes pop-out hint dismissed; no-op if storage is unusable. */
export function dismissPopOutHint(app: App): void {
  try {
    app.saveLocalStorage(POPOUT_HINT_DISMISSED_KEY, "true");
  } catch (e) {
    logWarn("Failed to persist pop-out hint dismissal", e);
  }
}
