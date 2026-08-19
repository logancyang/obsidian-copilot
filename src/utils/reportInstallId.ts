/**
 * Stable per-installation identifier sent with report uploads, so the endpoint
 * can group one installation's reports and rate-limit without any account
 * identity. Persisted in `window.localStorage` (which Obsidian never syncs),
 * mirroring the storage idiom in `deviceId.ts` / `homeShelfPrefs.ts`.
 *
 * A module of its own rather than a reuse, deliberately:
 *   - `getDeviceId()` falls back to `"unknown"` or a dashless hex string, and
 *     the report endpoint validates this header as a UUIDv4 — a fallback value
 *     would turn every upload into a rejected request.
 *   - `settings.userId` rides along on licensed API calls, so reusing it would
 *     let a report be joined to a paid account — exactly what the report
 *     path's missing auth header is meant to prevent. It is also vault-scoped
 *     and synced, which is not what "installation" means.
 */

import { v4 as uuidv4, validate as validateUuid, version as uuidVersion } from "uuid";

const REPORT_INSTALL_ID_STORAGE_KEY = "obsidian-copilot:report-install-id:v1";

/** Process-lifetime cache so one session always reports the same id. */
let cachedInstallId: string | null = null;

function isUuidV4(value: string): boolean {
  return validateUuid(value) && uuidVersion(value) === 4;
}

/**
 * Return this installation's report id, minting and persisting one on first
 * use. A stored value that is not a well-formed UUIDv4 (hand-edited, corrupted)
 * is replaced rather than sent — the server would reject the whole upload over
 * it, with an error the user cannot act on.
 *
 * @throws When `localStorage` is unusable (disabled, restricted), raw: the one
 *   caller — the upload adapter — replaces the message wholesale with fixed
 *   copy, so sanitizing here too would be a second trust boundary guarding the
 *   same edge. Callers must refuse to upload rather than send a non-UUID
 *   placeholder, which the endpoint rejects, or a per-session random id, which
 *   would defeat the per-installation rate limit the header exists for.
 */
export function getReportInstallId(): string {
  if (cachedInstallId) return cachedInstallId;

  // DESIGN NOTE — two renderer windows minting concurrently can each write
  // their own first id; `getItem` + `setItem` is not a transaction. The loser's
  // id is overwritten and its uploads count against a different install bucket
  // once. Accepted: reaching it needs two simultaneous first-ever uploads from
  // separate windows, and the cost is one miscounted rate-limit slot.
  const storage = window.localStorage;
  const existing = storage.getItem(REPORT_INSTALL_ID_STORAGE_KEY);
  if (existing && isUuidV4(existing)) {
    cachedInstallId = existing;
    return existing;
  }

  const minted = uuidv4();
  storage.setItem(REPORT_INSTALL_ID_STORAGE_KEY, minted);
  cachedInstallId = minted;
  return minted;
}
