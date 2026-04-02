import { isSelfHostAccessValid } from "@/plusUtils";
import { CopilotSettings } from "@/settings/model";
import { App, FileSystemAdapter, Platform } from "obsidian";

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
 * Resolve the folder path sent to Miyo as `folder_path`.
 *
 * When a remote server URL is configured and the user has set a remote vault folder,
 * that override is used — the remote machine's folder path may differ from the local
 * vault path. Falls back to the local vault filesystem path, then vault name.
 *
 * @param app - Obsidian application instance.
 * @param settings - Current Copilot settings.
 * @returns Remote vault folder override when applicable, otherwise local vault path.
 */
export function getMiyoFolderPath(app: App, settings: CopilotSettings): string {
  const remoteVaultFolder = (settings.miyoRemoteVaultPath || "").trim();
  if (remoteVaultFolder && getMiyoCustomUrl(settings)) {
    return remoteVaultFolder;
  }
  const vaultPath = getVaultBasePath(app);
  if (vaultPath) {
    return vaultPath;
  }
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
 * Convert a Miyo file path back to a vault-relative path when it belongs to the current vault.
 *
 * @param app - Obsidian application instance.
 * @param miyoPath - Path returned by Miyo.
 * @returns Vault-relative path when the file is inside the current vault, otherwise the original path.
 */
export function getVaultRelativeMiyoPath(app: App, miyoPath: string): string {
  const vaultPath = getVaultBasePath(app);
  if (!vaultPath) {
    return miyoPath;
  }

  const normalizedVaultPath = normalizeFilesystemPath(vaultPath);
  const normalizedMiyoPath = normalizeFilesystemPath(miyoPath);
  const prefix = `${normalizedVaultPath}/`;

  if (normalizedMiyoPath.startsWith(prefix)) {
    return normalizedMiyoPath.slice(prefix.length);
  }

  return miyoPath;
}

/**
 * Resolve the base path for the current vault when available.
 *
 * @param app - Obsidian application instance.
 * @returns Vault base path or undefined when unavailable.
 */
export function getVaultBasePath(app: App): string | undefined {
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

/**
 * Normalize a filesystem path for prefix comparisons across platforms.
 *
 * @param path - Filesystem path.
 * @returns Normalized path with forward slashes and no trailing slash.
 */
function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
