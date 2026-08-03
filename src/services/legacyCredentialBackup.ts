/**
 * One-time rescue of pre-v4 credentials out of `data.json`.
 *
 * v4 keeps credentials in the Obsidian Keychain and strips them from
 * `data.json` on first load. Vaults that never ran the pre-v4 "Migrate to
 * Obsidian Keychain" flow still hold their only copy of those keys in that
 * file, so stripping it without a copy destroys them.
 *
 * This module writes that copy. It is deliberately self-contained and reads
 * nothing about credential shapes: it copies the raw file verbatim, so
 * encrypted values survive without being decrypted and no future secret field
 * can be missed. Delete this module and its call site once pre-v4 vaults are
 * no longer a concern; nothing else depends on it.
 */

import { hasPersistedSecrets } from "@/services/settingsSecretTransforms";

/** File name written next to `data.json`, inside the plugin folder. */
export const LEGACY_BACKUP_FILENAME = "data-v3-credentials-backup.json";

/** Filesystem operations the rescue needs, so it stays testable and app-free. */
export interface LegacyBackupFileIO {
  exists: (path: string) => Promise<boolean>;
  write: (path: string, contents: string) => Promise<void>;
}

/** Outcome of a rescue attempt, which decides whether stripping may proceed. */
export type LegacyBackupResult =
  | { status: "not-needed" }
  | { status: "backed-up"; path: string }
  | { status: "failed"; error: unknown };

/**
 * Copy `data.json` verbatim before v4 strips its credentials.
 *
 * A `failed` result means the caller must leave `data.json` alone: the file is
 * still the only copy of those keys. An existing backup is never overwritten,
 * so a rerun cannot replace a good copy with a worse one.
 *
 * @param rawData - Raw `data.json` contents as loaded from disk.
 * @param pluginDir - Plugin folder that holds `data.json`.
 * @param io - Filesystem access used to test for and write the backup.
 */
export async function backupLegacyCredentials(
  rawData: unknown,
  pluginDir: string,
  io: LegacyBackupFileIO
): Promise<LegacyBackupResult> {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return { status: "not-needed" };
  }
  if (!hasPersistedSecrets(rawData as Record<string, unknown>)) {
    return { status: "not-needed" };
  }

  const path = `${pluginDir}/${LEGACY_BACKUP_FILENAME}`;
  try {
    if (await io.exists(path)) {
      return { status: "backed-up", path };
    }
    await io.write(path, JSON.stringify(rawData, null, 2));
    return { status: "backed-up", path };
  } catch (error) {
    return { status: "failed", error };
  }
}
