import { logWarn } from "@/logger";
import { matchSystemRoots } from "@/search/searchUtils";
import { getCopilotSaveData } from "@/settings/copilotSaveData";
import {
  type CopilotSettings,
  getSettings,
  normalizeRootFolders,
  setSettings,
  validateCopilotFolder,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import type { App } from "obsidian";
import { normalizePath, TFile } from "obsidian";

function buildRootPatch(
  current: Pick<CopilotSettings, "copilotFolder" | "copilotRootHistory">,
  folder: string
): Pick<CopilotSettings, "copilotFolder" | "copilotRootHistory"> {
  return {
    copilotRootHistory: normalizeRootFolders([
      ...current.copilotRootHistory,
      current.copilotFolder,
      folder,
    ]),
    copilotFolder: folder,
  };
}

export function copilotRootContainsNotes(app: App, folder: string): boolean {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return false;
  return app.vault.getMarkdownFiles().some((file) => matchSystemRoots(file.path, [root]));
}

export function findCopilotRootFileConflict(app: App, folder: string): string | null {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return null;
  let prefix = "";
  for (const segment of root.split("/")) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(prefix) instanceof TFile) {
      return prefix;
    }
  }
  return null;
}

export async function applyCopilotRootChange(app: App, newRoot: string): Promise<void> {
  const validation = validateCopilotFolder(newRoot, app.vault.configDir);
  if (!validation.ok) {
    logWarn("Copilot root change rejected an invalid folder value.", validation.reason);
    return;
  }
  const folder = validation.folder;
  const saveData = getCopilotSaveData(app);

  await runPersistenceTransaction(async () => {
    const previous = getSettings();
    const target: CopilotSettings = { ...previous, ...buildRootPatch(previous, folder) };
    await persistSettingsWithinTransaction(target, saveData, previous);

    const fresh = getSettings();
    const merged: CopilotSettings = { ...fresh, ...buildRootPatch(fresh, folder) };
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      try {
        await persistSettingsWithinTransaction(merged, saveData, target);
      } catch (reconcileError) {
        logWarn(
          "Copilot root change: reconcile save for a concurrent edit failed; " +
            "it stays in memory and lands with the next save.",
          reconcileError
        );
      }
    }

    suppressNextPersistOnce();
    setSettings((current) => buildRootPatch(current, folder));
  });
}
