import {
  getMiyoStatusSnapshot,
  isMiyoAvailableForCapability,
  refreshMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { logWarn } from "@/logger";
import {
  MiyoClient,
  type MiyoFolderEntry,
  subscribeToMiyoFolderNotRegistered,
} from "@/miyo/MiyoClient";
import {
  CopilotSettings,
  getSettings,
  normalizeMiyoFolderNames,
  subscribeToSettingsChange,
} from "@/settings/model";
import { err2String } from "@/utils";
import { getVaultBase } from "@/utils/vaultPath";
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

// The switch defaults on, so it only takes effect while Miyo is connected.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/716
export function isMiyoSearchActive(
  settings: Pick<CopilotSettings, "enableMiyo" | "enableMiyoSearchSkill">
): boolean {
  return settings.enableMiyo === true && settings.enableMiyoSearchSkill === true;
}

export function isMiyoParseActive(
  settings: Pick<CopilotSettings, "enableMiyo" | "enableMiyoDocumentProcessing">
): boolean {
  return settings.enableMiyo === true && settings.enableMiyoDocumentProcessing === true;
}

export async function canProcessDocumentsWithMiyo(
  settings: CopilotSettings = getSettings()
): Promise<boolean> {
  if (!settings.enableMiyoDocumentProcessing || !shouldUseMiyo(settings)) {
    return false;
  }
  const status = getMiyoStatusSnapshot().documentProcessor;
  if (status === "unknown" || status === "stale") {
    await refreshMiyoStatus();
  }
  return isMiyoAvailableForCapability("documentProcessor");
}

export interface MiyoSearchFolderOption {
  name: string;
  isChat: boolean;
}

export function getExtraSearchFolderOptions(
  entries: readonly MiyoFolderEntry[],
  vaultName: string
): MiyoSearchFolderOption[] {
  // Only names the saved folder list keeps verbatim are offered, the vault is always
  // searched already, and Miyo rejects a name two folders share as ambiguous, which
  // would fail every vault search. https://github.com/logancyang/obsidian-copilot/issues/3508
  const names = entries.map((entry) => entry.path);
  const offered = new Set(normalizeMiyoFolderNames(names));
  offered.delete(vaultName);
  const options: MiyoSearchFolderOption[] = [];
  for (const entry of entries) {
    if (names.indexOf(entry.path) === names.lastIndexOf(entry.path) && offered.delete(entry.path)) {
      options.push({ name: entry.path, isChat: entry.origin === "chat_sync" });
    }
  }
  return options;
}

let miyoFolderName: string | undefined;
let miyoFolderLookup = 0;
const miyoFolderNameListeners = new Set<() => void>();

export function getMiyoFolderName(app: App): string {
  return miyoFolderName ?? app.vault.getName();
}

export function subscribeToMiyoFolderName(listener: () => void): () => void {
  miyoFolderNameListeners.add(listener);
  return () => {
    miyoFolderNameListeners.delete(listener);
  };
}

// Relevant Notes can ask while the name is being looked up, so it must hear when the answer changes the name.
// https://github.com/logancyang/obsidian-copilot/issues/3690
function setMiyoFolderName(app: App, name: string | undefined): void {
  const previous = getMiyoFolderName(app);
  miyoFolderName = name;
  if (getMiyoFolderName(app) !== previous)
    miyoFolderNameListeners.forEach((listener) => listener());
}

// Miyo names a folder after its directory unless the user picks another name, so the vault is looked up by its
// absolute path; a Miyo with no folder there, such as one on another computer, knows the vault by its name. The
// last known name stays until Miyo answers, because announcing a stand-in made every rejected request look up again.
// https://github.com/logancyang/obsidian-copilot/issues/3690
export async function refreshMiyoFolderName(
  app: App,
  client: Pick<MiyoClient, "resolveBaseUrl" | "getFolder">
): Promise<void> {
  const lookup = ++miyoFolderLookup;
  const settings = getSettings();
  const vaultBase = getVaultBase(app);
  if (!vaultBase || !shouldUseMiyo(settings)) return;
  const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings));
  const folder = await client.getFolder(baseUrl, vaultBase);
  if (lookup === miyoFolderLookup) setMiyoFolderName(app, folder?.path);
}

export function watchMiyoFolderName(
  app: App,
  client: Pick<MiyoClient, "resolveBaseUrl" | "getFolder"> = new MiyoClient()
): () => void {
  const refresh = () => {
    refreshMiyoFolderName(app, client).catch((error) =>
      logWarn(`Could not look up the vault's Miyo folder: ${err2String(error)}`)
    );
  };
  refresh();
  const unsubscribeSettings = subscribeToSettingsChange((prev, next) => {
    if (
      shouldUseMiyo(prev) !== shouldUseMiyo(next) ||
      getMiyoCustomUrl(prev) !== getMiyoCustomUrl(next)
    ) {
      refresh();
    }
  });
  const unsubscribeFolder = subscribeToMiyoFolderNotRegistered((folderName) => {
    if (folderName === undefined || folderName === getMiyoFolderName(app)) refresh();
  });
  return () => {
    unsubscribeSettings();
    unsubscribeFolder();
  };
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
