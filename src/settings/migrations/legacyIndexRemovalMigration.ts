/**
 * One-time migration (settings v13): retire the client-side index settings and
 * delete only Copilot's known index artifacts.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/283
 */

import { logWarn } from "@/logger";

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
  rmdir(path: string, recursive: boolean): Promise<void>;
}

/** Dependencies for the one-time legacy index cleanup. */
export interface LegacyIndexCleanupContext {
  adapter: LegacyIndexCleanupAdapter;
  configDir: string;
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

async function cleanupFolder(
  context: LegacyIndexCleanupContext,
  folder: string,
  removeWhenEmpty: boolean
): Promise<void> {
  try {
    if (!(await context.adapter.exists(folder))) return;

    const listing = await context.adapter.list(folder);
    let failed = false;
    for (const path of listing.files) {
      if (!isDirectLegacyArtifact(folder, path)) continue;
      try {
        await context.adapter.remove(path);
      } catch (error) {
        failed = true;
        logWarn(`[settings-migration] failed to remove legacy index artifact in ${folder}`, error);
      }
    }

    if (removeWhenEmpty && !failed) {
      const remaining = await context.adapter.list(folder);
      if (remaining.files.length === 0 && remaining.folders.length === 0) {
        // Obsidian's adapter requires recursive directory removal even for an
        // empty directory. This call is restricted to the dedicated legacy
        // root after a second empty check; the config directory never reaches it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/283
        await context.adapter.rmdir(folder, true);
      }
    }

    if (failed) context.notifyFailure(folder);
  } catch (error) {
    logWarn(`[settings-migration] failed to clean legacy index folder ${folder}`, error);
    context.notifyFailure(folder);
  }
}

/**
 * Delete allowlisted index artifacts directly inside the former index folders.
 *
 * The vault config directory is never removed. The root `.copilot-index`
 * directory is removed non-recursively only after a second listing proves it
 * empty.
 *
 * @param context - Vault adapter, active config directory, and failure notifier.
 */
export async function cleanupLegacyIndexArtifacts(
  context: LegacyIndexCleanupContext
): Promise<void> {
  const configDir = context.configDir.replace(/\/+$/, "");
  const rootIndexIsConfigDir = configDir === LEGACY_INDEX_DIRECTORY;
  // A vault may use a custom config-directory name. If it happens to equal the
  // legacy index directory, it still receives the stronger config-dir promise:
  // delete allowlisted files directly inside it, but never remove the folder.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/283
  await cleanupFolder(context, LEGACY_INDEX_DIRECTORY, !rootIndexIsConfigDir);
  if (!rootIndexIsConfigDir) {
    await cleanupFolder(context, configDir, false);
  }
}
