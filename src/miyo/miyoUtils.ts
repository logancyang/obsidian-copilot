import { isSelfHostAccessValid } from "@/plusUtils";
import { CopilotSettings, getSettings } from "@/settings/model";
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
 * Resolve the vault identifier sent to Miyo.
 *
 * Uses the user-configured remote vault path only when a remote server URL is also
 * configured, otherwise falls back to the vault filesystem path or vault name.
 *
 * @param app - Obsidian application instance.
 * @returns Remote vault path when a remote server is configured, vault folder path when available, otherwise vault name.
 */
export function getMiyoVault(app: App): string {
  const settings = getSettings();
  const remoteVaultPath = (settings.miyoRemoteVaultPath || "").trim();
  const serverUrl = (settings.miyoServerUrl || "").trim();
  if (remoteVaultPath && serverUrl) {
    return remoteVaultPath;
  }
  const vaultPath = getVaultBasePath(app);
  if (vaultPath) {
    return vaultPath;
  }
  return app.vault.getName();
}

/**
 * Resolve the vault identifier that would apply given a vault path override, used for UI preview.
 *
 * @param app - Obsidian application instance.
 * @param vaultPathOverride - The vault path to use (empty string = auto-detect).
 * @returns Overridden vault path, or auto-detected vault path/name.
 */
export function resolveMiyoVault(app: App, vaultNameOverride: string): string {
  const trimmed = vaultNameOverride.trim();
  if (trimmed) {
    return trimmed;
  }
  const vaultPath = getVaultBasePath(app);
  if (vaultPath) {
    return vaultPath;
  }
  return app.vault.getName();
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
