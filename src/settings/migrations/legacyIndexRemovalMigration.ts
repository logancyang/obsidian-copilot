/**
 * Deprecated: Vault QA and its local index are unsupported; cleanup awaits removal.
 *
 * Device-local cleanup for the retired client-side index pipeline: delete only
 * Copilot's known index artifacts and the credentials the removed embedding
 * models owned.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/283
 */

import { logWarn } from "@/logger";

/**
 * Device-local marker key recording that this device finished the cleanup.
 * Lives in Obsidian's vault-scoped local storage, which never syncs.
 */
export const LEGACY_INDEX_CLEANUP_STORAGE_KEY = "obsidian-copilot:legacy-index-cleanup:v1";

const LEGACY_INDEX_DIRECTORY = ".copilot-index";
const LEGACY_INDEX_ARTIFACT_PATTERNS = [
  /^copilot-index-[a-f0-9]{32}\.json$/,
  /^copilot-index-chunk-[a-f0-9]{32}-\d+\.json$/,
  /^copilot-index-chunk-[a-f0-9]{32}-metadata\.json$/,
] as const;

/** Mobile-safe subset of Obsidian's vault adapter used by the cleanup. */
export interface LegacyIndexCleanupAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
}

/** Dependencies for the one-time legacy index cleanup. */
export interface LegacyIndexCleanupContext {
  adapter: LegacyIndexCleanupAdapter;
  configDir: string;
  /** True once this device has completed the cleanup. */
  hasRun(): boolean;
  /** Record that this device completed the cleanup. */
  markRun(): void;
  /** Drop keychain entries the removed embedding models owned. */
  removeRetiredEmbeddingSecrets(): void;
  notifyFailure(folder: string): void;
}

function isDirectLegacyArtifact(folder: string, path: string): boolean {
  const prefix = `${folder.replace(/\/+$/, "")}/`;
  if (!path.startsWith(prefix)) return false;

  const filename = path.slice(prefix.length);
  return (
    !filename.includes("/") &&
    LEGACY_INDEX_ARTIFACT_PATTERNS.some((pattern) => pattern.test(filename))
  );
}

/**
 * Delete the allowlisted artifacts directly inside one folder.
 *
 * @returns True when every recognized artifact was removed.
 */
async function cleanupFolder(context: LegacyIndexCleanupContext, folder: string): Promise<boolean> {
  try {
    if (!(await context.adapter.exists(folder))) return true;

    const listing = await context.adapter.list(folder);
    let failed = false;
    for (const path of listing.files) {
      if (!isDirectLegacyArtifact(folder, path)) continue;
      try {
        await context.adapter.remove(path);
      } catch (error) {
        failed = true;
        logWarn(
          `[legacy-index-cleanup] failed to remove legacy index artifact in ${folder}`,
          error
        );
      }
    }

    if (failed) context.notifyFailure(folder);
    return !failed;
  } catch (error) {
    logWarn(`[legacy-index-cleanup] failed to clean legacy index folder ${folder}`, error);
    context.notifyFailure(folder);
    return false;
  }
}

/**
 * Remove this device's remnants of the retired index pipeline: allowlisted
 * artifacts directly inside the former index folders, plus the keychain entries
 * the removed embedding models owned.
 *
 * Gated by a device-local marker rather than the settings version, because
 * `settingsVersion` syncs: a second device would otherwise arrive already
 * stamped and never clean its own files or credentials.
 * https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692787
 *
 * Emptied directories are left in place. Obsidian's adapter can only remove a
 * directory recursively, and an emptiness check cannot be atomic with that
 * removal, so a file another writer restores in between would be deleted
 * despite the allowlist promise.
 * https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692778
 *
 * @param context - Vault adapter, active config directory, device-local marker,
 *   credential cleanup, and failure notifier.
 */
export async function cleanupLegacyIndexArtifacts(
  context: LegacyIndexCleanupContext
): Promise<void> {
  if (context.hasRun()) return;

  const configDir = context.configDir.replace(/\/+$/, "");
  let cleaned = await cleanupFolder(context, LEGACY_INDEX_DIRECTORY);
  // A vault may use a custom config-directory name. Cleaning it twice would
  // double-report the same failure, so only visit a distinct directory.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/283
  if (configDir !== LEGACY_INDEX_DIRECTORY) {
    cleaned = (await cleanupFolder(context, configDir)) && cleaned;
  }

  context.removeRetiredEmbeddingSecrets();

  // A failed pass stays unmarked so the next launch retries it.
  if (cleaned) context.markRun();
}
