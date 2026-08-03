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
import { sha256 } from "@/utils/hash";

/** Prefix of the backup file written next to `data.json`, in the plugin folder. */
export const LEGACY_BACKUP_PREFIX = "data-v3-credentials-backup";

/**
 * Name the backup after the bytes it contains.
 *
 * Reason: the file name has to answer "is this snapshot already saved?" on its
 * own. A fixed name cannot: a second launch would find the earlier file and
 * treat it as proof, even when `data.json` has since changed (a prior strip
 * failed and Sync then delivered different credentials from a device still on
 * v3), and would clear credentials that appear in no backup. Deriving the name
 * from the contents makes a hit mean "these exact bytes are already saved" and
 * gives any different snapshot its own file, so nothing is ever overwritten.
 */
export function legacyBackupFilename(contents: string): string {
  return `${LEGACY_BACKUP_PREFIX}-${sha256(contents).slice(0, 8)}.json`;
}

/** Filesystem operations the rescue needs, so it stays testable and app-free. */
export interface LegacyBackupFileIO {
  exists: (path: string) => Promise<boolean>;
  write: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

/** Outcome of a rescue attempt, which decides whether stripping may proceed. */
export type LegacyBackupResult =
  | { status: "not-needed" }
  /** `encrypted` marks a copy holding `enc_*` values, which cannot simply be re-entered. */
  | { status: "backed-up"; path: string; encrypted: boolean }
  | { status: "failed"; error: unknown };

/**
 * Whether a backup holds values encrypted by the pre-v4 encryption toggle.
 *
 * Reason: the only credential shape this module inspects, and only because
 * recovery differs entirely for it. A readable key is re-entered and the backup
 * deleted; an `enc_*` value cannot be re-entered at all, so telling its owner to
 * delete the file would destroy the sole copy their v3 device could decrypt.
 */
function holdsEncryptedValues(contents: string): boolean {
  return /"enc_[a-z]+_/.test(contents);
}

/**
 * Copy `data.json` verbatim before v4 strips its credentials.
 *
 * A `failed` result means the caller must leave `data.json` alone: the file is
 * still the only copy of those keys. The backup is named after its contents and
 * renamed into place only once fully written, so its presence proves those
 * exact bytes are saved: a rerun over unchanged data reuses it, a changed
 * `data.json` gets its own file, and no backup is ever overwritten.
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

  const contents = JSON.stringify(rawData, null, 2);
  const path = `${pluginDir}/${legacyBackupFilename(contents)}`;
  try {
    if (!(await io.exists(path))) {
      // Reason: write to a staging name and rename into place, so the final
      // path only ever exists once the bytes are complete. Writing directly
      // would leave a truncated file if the write is interrupted, and the next
      // launch would read that path's existence as proof and strip data.json.
      const staging = `${path}.writing`;
      await io.write(staging, contents);
      await io.rename(staging, path);
    }
    return { status: "backed-up", path, encrypted: holdsEncryptedValues(contents) };
  } catch (error) {
    return { status: "failed", error };
  }
}
