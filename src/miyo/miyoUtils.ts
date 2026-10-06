import {
  getMiyoStatusSnapshot,
  isMiyoAvailableForCapability,
  refreshMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import type { MiyoFolderEntry } from "@/miyo/MiyoClient";
import { CopilotSettings, getSettings, normalizeMiyoFolderNames } from "@/settings/model";
import { App } from "obsidian";

export { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";

export const MIYO_DEEPLINK_URL = "miyo://";

export const MIYO_ADD_FOLDER_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}add-folder`;

export const MIYO_CONNECT_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}connect`;

export const MIYO_CHATS_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}chats`;

export function isLocalMiyoUrl(customUrl: string): boolean {
  if (!customUrl.trim()) {
    return true;
  }
  try {
    const hostname = new URL(customUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getSearchBackend(settings: CopilotSettings = getSettings()): "keyword" | "miyo" {
  return shouldUseMiyo(settings) ? "miyo" : "keyword";
}

export function seedDocProcessorBackend(
  settings: CopilotSettings = getSettings()
): "plus" | "miyo" {
  return settings.enableSelfHostMode && settings.enableMiyo ? "miyo" : "plus";
}

export type ResolvedDocProcessorBackend = "plus" | "miyo" | "miyo-unavailable";

export async function resolveDocProcessorBackend(
  settings: CopilotSettings = getSettings()
): Promise<ResolvedDocProcessorBackend> {
  if (settings.docProcessorBackend !== "miyo") {
    return "plus";
  }
  if (!shouldUseMiyo(settings)) {
    return "miyo-unavailable";
  }
  const status = getMiyoStatusSnapshot().documentProcessor;
  if (status === "unknown" || status === "stale") {
    await refreshMiyoStatus();
  }
  return isMiyoAvailableForCapability("documentProcessor") ? "miyo" : "miyo-unavailable";
}

export interface MiyoSearchFolderOption {
  name: string;
  isChat: boolean;
}

export function getExtraSearchFolderOptions(
  entries: readonly MiyoFolderEntry[],
  vaultName: string
): MiyoSearchFolderOption[] {
  // Only names the saved folder list keeps verbatim are offered, and the vault is
  // always searched already. https://github.com/logancyang/obsidian-copilot/issues/3508
  const offered = new Set(normalizeMiyoFolderNames(entries.map((entry) => entry.path)));
  offered.delete(vaultName);
  const options: MiyoSearchFolderOption[] = [];
  for (const entry of entries) {
    if (offered.delete(entry.path)) {
      options.push({ name: entry.path, isChat: entry.origin === "chat_sync" });
    }
  }
  return options;
}

export function getMiyoFolderName(app: App): string {
  return app.vault.getName();
}

export function getMiyoFilePath(app: App, vaultRelativePath: string): string {
  const normalized = normalizeFilesystemPath(vaultRelativePath).replace(/^\/+/, "");
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    return normalized;
  }
  return `${folderName}/${normalized}`;
}

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

export function isCurrentVaultMiyoPath(app: App, miyoPath: string): boolean {
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    return true;
  }
  return normalizeFilesystemPath(miyoPath).startsWith(`${folderName}/`);
}
