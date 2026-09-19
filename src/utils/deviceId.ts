/**
 * Stable, device-local identifier used to segment device-specific agent
 * settings (binary paths, env overrides) so a synced `data.json` never carries
 * one device's paths as a single global value.
 *
 * Design (see GitHub #2539):
 *   - A random UUID generated once and persisted via Obsidian's
 *     `App.saveLocalStorage`, which is device-local (never synced) and
 *     vault-scoped — so each vault on a device keeps its own id and reads its
 *     own segment of `agentMode.deviceProfiles`.
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
import { v4 as uuidv4, validate as validateUuid, version as uuidVersion } from "uuid";

const DEVICE_ID_STORAGE_KEY = "obsidian-copilot:device-id:v1";

/** Stable id when device-local storage can't be read or written, so a
 *  broken-storage device keeps a single profile segment instead of a new
 *  random id each session. */
const FALLBACK_DEVICE_ID = "unknown";

// Each vault owns its identity, including its sticky storage-failure fallback.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/202
const cachedDeviceIds = new WeakMap<App, string>();

/**
 * Return this device's stable id, generating and persisting one on first use.
 *
 * Synchronous so it can be called from the `saveData` write path.
 *
 * @param app - Active Obsidian app; owns the vault-scoped device-local store
 *   the id lives in.
 */
export function getDeviceId(app: App): string {
  const cachedDeviceId = cachedDeviceIds.get(app);
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const existing = app.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
    if (typeof existing === "string" && existing.length > 0) {
      cachedDeviceIds.set(app, existing);
      return existing;
    }

    const id = uuidv4();
    app.saveLocalStorage(DEVICE_ID_STORAGE_KEY, id);
    // Reason: `saveLocalStorage` swallows write failures instead of throwing.
    // Without a read-back check, a broken-storage device would mint a new
    // random id every session and orphan a profile segment each time; the
    // shared sentinel keeps it on one segment.
    if (app.loadLocalStorage(DEVICE_ID_STORAGE_KEY) !== id) {
      cachedDeviceIds.set(app, FALLBACK_DEVICE_ID);
      return FALLBACK_DEVICE_ID;
    }
    cachedDeviceIds.set(app, id);
    return id;
  } catch {
    // Storage access threw (disabled / restricted). Fall back to a stable
    // sentinel so this device keeps one profile segment instead of a new
    // random id each session.
    cachedDeviceIds.set(app, FALLBACK_DEVICE_ID);
    return FALLBACK_DEVICE_ID;
  }
}

/**
 * Return the existing device identity only when it is a persisted UUIDv4.
 * Report uploads require this stricter contract than device settings, which
 * retain legacy identifiers and a storage-failure fallback as profile keys.
 *
 * @param app - Obsidian app whose vault owns the device identifier.
 * @throws When the identifier is not a UUIDv4 or storage cannot confirm it.
 */
export function getPersistedDeviceId(app: App): string {
  const id = getDeviceId(app);
  // Uploads reject non-UUID identities, and accepting a cached but unpersisted
  // identity would allow a fresh rate-limit bucket after every restart.
  // Preserve legacy profile keys rather than orphaning their saved settings.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  if (
    !validateUuid(id) ||
    uuidVersion(id) !== 4 ||
    app.loadLocalStorage(DEVICE_ID_STORAGE_KEY) !== id
  ) {
    throw new Error("A persisted UUIDv4 device identifier is required.");
  }
  return id;
}
