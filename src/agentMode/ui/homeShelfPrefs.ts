/**
 * Device-local UI preferences for the Agent Home shelf, persisted in
 * `window.localStorage` (which Obsidian never syncs). Mirrors the storage idiom
 * in `deviceId.ts`: every access is wrapped in try/catch, reads return a safe
 * default on failure, and writes swallow errors so a broken-storage device
 * (disabled / restricted) never crashes the UI — it just loses persistence.
 *
 * These are intentionally device-local: which shelf tab you last viewed and
 * whether you dismissed the pop-out hint are per-device UI state, not content
 * that should ride a synced `data.json` to your other devices.
 */

import { logWarn } from "@/logger";

export const HOME_SHELF_TAB_STORAGE_KEY = "copilot:home-shelf-tab:v1";
const POPOUT_HINT_DISMISSED_KEY = "copilot:relevant-notes-popout-hint-dismissed:v1";

/** Read the last-selected shelf tab id, or `null` when unset or storage is unusable. */
export function getHomeShelfTab(storageKey: string): string | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Persist the selected shelf tab id; no-op if storage is unusable. */
export function setHomeShelfTab(storageKey: string, id: string): void {
  try {
    window.localStorage.setItem(storageKey, id);
  } catch (e) {
    logWarn("Failed to persist home shelf tab", e);
  }
}

/** Whether the user dismissed the Relevant Notes pop-out hint; defaults to false. */
export function isPopOutHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(POPOUT_HINT_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Mark the Relevant Notes pop-out hint dismissed; no-op if storage is unusable. */
export function dismissPopOutHint(): void {
  try {
    window.localStorage.setItem(POPOUT_HINT_DISMISSED_KEY, "true");
  } catch (e) {
    logWarn("Failed to persist pop-out hint dismissal", e);
  }
}
