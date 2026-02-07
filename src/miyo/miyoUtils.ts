import { MD5 } from "crypto-js";
import { App, FileSystemAdapter } from "obsidian";

/**
 * Compute a stable source_id for Miyo based on the vault name and path hash.
 *
 * @param app - Obsidian application instance.
 * @returns Stable source_id string.
 */
export function getMiyoSourceId(app: App): string {
  const vaultName = app.vault.getName();
  const vaultPath = getVaultBasePath(app);
  const pathHash = MD5(vaultPath ?? vaultName).toString();
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
