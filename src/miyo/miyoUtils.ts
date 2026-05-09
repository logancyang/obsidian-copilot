import { isSelfHostAccessValid } from "@/plusUtils";
import { CopilotSettings } from "@/settings/model";
import { App, FileSystemAdapter, Platform } from "obsidian";

/**
 * Convert backslashes to forward slashes and trim trailing slashes.
 *
 * @param path - Filesystem path.
 * @returns Normalized path.
 */
function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Return the user-configured Miyo server URL, or "" to fall back to local service discovery.
 * Uses `|| ""` to guard against undefined when loaded from older saved settings.
 *
 * @param settings - Current Copilot settings.
 * @returns Trimmed URL string like "http://192.168.1.10:8742", or "" when not configured.
 */
export function getMiyoCustomUrl(settings: CopilotSettings): string {
  return (settings.miyoServerUrl || "").trim();
}

/**
 * Single source of truth for whether Miyo should be used.
 *
 * Returns false when:
 * - `enableMiyo` is off, or
 * - self-host access is invalid, or
 * - running on mobile without a remote server URL (local service discovery
 *   is unavailable on mobile, so Miyo can only work via an explicit URL).
 *
 * Note: `enableSemanticSearchV3` need not be checked — the UI enforces that
 * enabling Miyo also enables semantic search, and disabling semantic search
 * also disables Miyo.
 *
 * @param settings - Current Copilot settings.
 */
export function shouldUseMiyo(settings: CopilotSettings): boolean {
  if (!settings.enableMiyo || !isSelfHostAccessValid()) {
    return false;
  }
  return !Platform.isMobile || !!getMiyoCustomUrl(settings);
}

/**
 * Resolve the folder identifier sent to Miyo as `folder_name`.
 *
 * @param app - Obsidian application instance.
 * @returns Vault folder name.
 */
export function getMiyoFolderName(app: App): string {
  return app.vault.getName();
}

/**
 * Resolve an absolute filesystem path for a vault file so it can be sent to Miyo.
 *
 * @param app - Obsidian application instance.
 * @param vaultRelativePath - Vault-relative note path.
 * @returns Absolute file path when available, otherwise the original path.
 */
export function getMiyoAbsolutePath(app: App, vaultRelativePath: string): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getFullPath(vaultRelativePath);
  }

  const adapterAny = adapter as unknown as { getFullPath?: (normalizedPath: string) => string };
  if (typeof adapterAny.getFullPath === "function") {
    return adapterAny.getFullPath(vaultRelativePath);
  }

  return vaultRelativePath;
}

/**
 * Convert a Miyo file path to a vault-relative path when it belongs to the current vault.
 *
 * Miyo always returns paths prefixed with their owning folder name. When the
 * prefix matches the current vault's folder name, strip it to get a
 * vault-relative path. Files from other vaults pass through unchanged. The
 * returned path is always normalized to forward slashes.
 *
 * @param app - Obsidian application instance.
 * @param miyoPath - Path returned by Miyo (e.g., "MyVault/notes/foo.md").
 * @returns Normalized vault-relative path when inside the current vault, otherwise the normalized original path.
 */
export function getVaultRelativeMiyoPath(app: App, miyoPath: string): string {
  const normalizedMiyoPath = normalizeFilesystemPath(miyoPath);
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    return normalizedMiyoPath;
  }

  const folderPrefix = `${folderName}/`;
  if (normalizedMiyoPath.startsWith(folderPrefix)) {
    return normalizedMiyoPath.slice(folderPrefix.length);
  }

  return normalizedMiyoPath;
}
