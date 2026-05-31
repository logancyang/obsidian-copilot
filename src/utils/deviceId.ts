/**
 * Stable, device-local identifier used to segment device-specific agent
 * settings (binary paths, env overrides) so a synced `data.json` never carries
 * one device's paths as a single global value.
 *
 * Design (see GitHub #2539):
 *   - A random UUID generated once and persisted in `window.localStorage`,
 *     which Obsidian never syncs — so each device keeps its own id and reads
 *     its own segment of `agentMode.deviceProfiles`.
 *   - We deliberately avoid OS/hardware identifiers (IOPlatformUUID,
 *     MachineGuid, /etc/machine-id): spawning system commands to read a
 *     hardware fingerprint raises privacy concerns and hardware identity isn't
 *     needed to solve a sync-collision problem.
 *   - Mirrors the existing per-device WebCrypto key precedent in
 *     `encryptionService.ts` (`obsidian-copilot:webcrypto-key:v1`).
 *
 * Caveat: because the id lives in app-local storage rather than hardware, it
 * resets if the user clears app data or reinstalls Obsidian. On reset the
 * device gets a new id and its previous profile segment is orphaned — harmless;
 * the user re-enters the path once.
 */

const DEVICE_ID_STORAGE_KEY = "obsidian-copilot:device-id:v1";

/** Process-lifetime cache so every call returns the same id, even if storage is unavailable. */
let cachedDeviceId: string | null = null;

function getLocalStorageSafe(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

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
 */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  const storage = getLocalStorageSafe();
  const existing = storage?.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing && existing.length > 0) {
    cachedDeviceId = existing;
    return existing;
  }

  const id = generateDeviceId();
  // Best-effort persist: if storage is unavailable the id stays session-stable
  // via the cache, so a single session never splits its own profile.
  try {
    storage?.setItem(DEVICE_ID_STORAGE_KEY, id);
  } catch {
    /* ignore — cached for the session */
  }
  cachedDeviceId = id;
  return id;
}
