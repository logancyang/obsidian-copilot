import { MD5 } from "crypto-js";
import { App, FileSystemAdapter } from "obsidian";

/**
 * Compute a stable collection name for Miyo based on the vault name and
 * the first three characters of the vault path MD5 hash.
 *
 * @param app - Obsidian application instance.
 * @returns Stable collection name string.
 */
export function getMiyoCollectionName(app: App): string {
  const vaultName = app.vault.getName();
  const vaultPath = getVaultBasePath(app);
  const pathHash = MD5(vaultPath ?? vaultName)
    .toString()
    .slice(0, 3);
  return `${vaultName}_${pathHash}`;
}

/**
 * Resolve the base path for the current vault when available.
 *
 * @param app - Obsidian application instance.
 * @returns Vault base path or undefined when unavailable.
 */
function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }

  const adapterAny = adapter as unknown as { getBasePath?: () => string; basePath?: string };
  if (typeof adapterAny.getBasePath === "function") {
    return adapterAny.getBasePath();
  }
  if (typeof adapterAny.basePath === "string") {
    return adapterAny.basePath;
  }
  return undefined;
}
