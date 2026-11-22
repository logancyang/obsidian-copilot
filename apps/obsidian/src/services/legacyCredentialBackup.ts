import { hasPersistedSecrets } from "@/services/settingsSecretTransforms";
import { sha256 } from "@/utils/hash";

export const LEGACY_BACKUP_PREFIX = "data-v3-credentials-backup";

export function legacyBackupFilename(contents: string): string {
  return `${LEGACY_BACKUP_PREFIX}-${sha256(contents).slice(0, 8)}.json`;
}

export interface LegacyBackupFileIO {
  exists: (path: string) => Promise<boolean>;
  write: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

export type LegacyBackupResult =
  | { status: "not-needed" }
  | { status: "backed-up"; path: string; encrypted: boolean }
  | { status: "failed"; error: unknown };

function holdsEncryptedValues(contents: string): boolean {
  return /"enc_[a-z]+_/.test(contents);
}

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
      const staging = `${path}.writing`;
      await io.write(staging, contents);
      await io.rename(staging, path);
    }
    return { status: "backed-up", path, encrypted: holdsEncryptedValues(contents) };
  } catch (error) {
    return { status: "failed", error };
  }
}
