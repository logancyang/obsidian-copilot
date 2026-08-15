/**
 * Stable, device-local identifier used to segment device-specific agent
 * settings (binary paths, env overrides) so a synced `data.json` never carries
 * one device's paths as a single global value.
 *
 * Design (see GitHub #2539, storage API per GitHub #298):
 *   - A random UUID generated once and persisted via Obsidian's
 *     `App.saveLocalStorage`, which is device-local (never synced) and
 *     vault-scoped — so each vault on a device keeps its own id and reads its
 *     own segment of `agentMode.deviceProfiles`. On first read the id is
 *     seeded from the legacy raw `localStorage` key that older releases shared
 *     across vaults, so existing profile segments stay attached; the legacy
 *     key is left in place for vaults that have not migrated yet.
 *   - We deliberately avoid OS/hardware identifiers (IOPlatformUUID,
 *     MachineGuid, /etc/machine-id): spawning system commands to read a
 *     hardware fingerprint raises privacy concerns and hardware identity isn't
 *     needed to solve a sync-collision problem.
 *
 * Caveat: because the id lives in app-local storage rather than hardware, it
 * resets if the user clears app data or reinstalls Obsidian. On reset the
 * device gets a new id and its previous profile segment is orphaned — harmless;
 * the user re-enters the path once. If storage is entirely unusable (disabled /
 * restricted), the id falls back to the shared `"unknown"` sentinel.
 */

import type { App } from "obsidian";

const DEVICE_ID_STORAGE_KEY = "obsidian-copilot:device-id:v1";

/** Stable id when device-local storage can't be read or written, so a
 *  broken-storage device keeps a single profile segment instead of a new
 *  random id each session. */
const FALLBACK_DEVICE_ID = "unknown";

/** Process-lifetime cache so every call returns the same id, even if storage is unavailable. */
let cachedDeviceId: string | null = null;

/** Generate a random id, preferring `crypto.randomUUID`, with progressive fallbacks. */
function generateDeviceId(): string {
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Reason: guard `getRandomValues` existence — optional chaining on a missing
  // method silently returns undefined, leaving the buffer zero-filled.
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Return this device's stable id, generating and persisting one on first use.
 *
 * Synchronous so it can be called from the `saveData` write path.
 *
 * @param app - Active Obsidian app; owns the vault-scoped device-local store
 *   the id lives in.
 */
export function getDeviceId(app: App): string {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const existing = app.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
    if (typeof existing === "string" && existing.length > 0) {
      cachedDeviceId = existing;
      return existing;
    }

    const legacy = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (legacy && legacy.length > 0) {
      // One-time forward migration: copy the pre-vault-scoped id so this
      // vault's `deviceProfiles`, Miyo receipt, and pending credential recovery
      // stay attached. Returned even if the copy silently fails — the legacy
      // key remains, so the next launch resolves the same id and retries the
      // copy. Remove after 2026-08-21 to clear the scorecard warning.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/298
      app.saveLocalStorage(DEVICE_ID_STORAGE_KEY, legacy);
      cachedDeviceId = legacy;
      return legacy;
    }

    const id = generateDeviceId();
    app.saveLocalStorage(DEVICE_ID_STORAGE_KEY, id);
    // Reason: `saveLocalStorage` swallows write failures instead of throwing.
    // Without a read-back check, a broken-storage device would mint a new
    // random id every session and orphan a profile segment each time; the
    // shared sentinel keeps it on one segment.
    if (app.loadLocalStorage(DEVICE_ID_STORAGE_KEY) !== id) {
      cachedDeviceId = FALLBACK_DEVICE_ID;
      return FALLBACK_DEVICE_ID;
    }
    cachedDeviceId = id;
    return id;
  } catch {
    // Storage access threw (disabled / restricted). Fall back to a stable
    // sentinel so this device keeps one profile segment instead of a new
    // random id each session.
    cachedDeviceId = FALLBACK_DEVICE_ID;
    return FALLBACK_DEVICE_ID;
  }
}
