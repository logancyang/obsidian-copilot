import { CopilotSettings } from "@/settings/model";
import { App, FileSystemAdapter } from "obsidian";

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
 * Resolve the Miyo source id for the current vault.
 *
 * @param app - Obsidian application instance.
 * @returns Vault folder path when available, otherwise vault name.
 */
export function getMiyoSourceId(app: App): string {
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
