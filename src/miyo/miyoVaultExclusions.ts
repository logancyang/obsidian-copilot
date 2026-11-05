import { logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoConnectionMode, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSystemExcludedFolders } from "@/search/searchUtils";
import {
  deriveCopilotFolder,
  deriveCopilotSubfolders,
  deriveLogFile,
  deriveProjectsFolder,
} from "@/settings/copilotFolder";
import { type CopilotSettings, getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

export function getMiyoSystemExcludedFolders(settings: CopilotSettings): string[] {
  const root = deriveCopilotFolder(settings);
  const projects = deriveProjectsFolder(settings);
  // Project folders hold the user's own work, so only Copilot's system files stay out of Miyo.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/847
  return [
    ...deriveCopilotSubfolders(settings).filter((folder) => folder !== projects),
    `${projects}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`,
    deriveLogFile(settings),
    ...getSystemExcludedFolders(settings).filter((folder) => folder !== root),
  ];
}

export async function migrateMiyoVaultExclusions(app: App): Promise<void> {
  const settings = getSettings();
  const vaultBase = getVaultBase(app);
  if (!vaultBase || !shouldUseMiyo(settings) || getMiyoConnectionMode(settings) !== "local") {
    return;
  }
  try {
    const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
    const baseUrl = await client.resolveBaseUrl();
    const { exclude_folders: excluded = [] } = await client.getFolder(baseUrl, vaultBase);
    const root = deriveCopilotFolder(settings);
    const systemFolders = getMiyoSystemExcludedFolders(settings);
    // Registrations made before project folders were indexed exclude the whole Copilot folder,
    // sometimes beside Obsidian-ignored paths inside it. Only the full system set marks an
    // updated list, so a whole-folder exclusion the user adds back afterwards stays.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/847
    if (!excluded.includes(root) || systemFolders.every((folder) => excluded.includes(folder))) {
      return;
    }
    const exclude_folders = [
      ...new Set(excluded.flatMap((folder) => (folder === root ? systemFolders : [folder]))),
    ];
    await client.updateFolder(baseUrl, { path: vaultBase, exclude_folders });
    logInfo(`Miyo now indexes the project folders in ${root}.`);
  } catch (error) {
    logWarn(`Could not update this vault's Miyo exclusions: ${err2String(error)}`);
  }
}
