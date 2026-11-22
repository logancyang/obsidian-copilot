// Device-local cleanup of the retired index pipeline: only known artifacts and the credentials
// the removed embedding models owned:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/283

import { logWarn } from "@/logger";

export const LEGACY_INDEX_CLEANUP_STORAGE_KEY = "obsidian-copilot:legacy-index-cleanup:v1";

const LEGACY_INDEX_DIRECTORY = ".copilot-index";
const LEGACY_INDEX_ARTIFACT_PATTERNS = [
  /^copilot-index-[a-f0-9]{32}\.json$/,
  /^copilot-index-chunk-[a-f0-9]{32}-\d+\.json$/,
  /^copilot-index-chunk-[a-f0-9]{32}-metadata\.json$/,
] as const;

export interface LegacyIndexCleanupAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
}

export interface LegacyIndexCleanupContext {
  adapter: LegacyIndexCleanupAdapter;
  configDir: string;
  hasRun(): boolean;
  markRun(): void;
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

  if (cleaned) context.markRun();
}
