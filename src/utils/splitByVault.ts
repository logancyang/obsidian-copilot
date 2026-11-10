import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { App, TAbstractFile, TFile, TFolder } from "obsidian";

export interface VaultSplit {
  vaultItems: TAbstractFile[];
  outsideFiles: File[];
  outsideFolderNames: string[];
}

interface IncomingFiles {
  files: ArrayLike<File>;
  items?: ArrayLike<DataTransferItem>;
}

interface ObsidianDraggable {
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

function isVaultItem(item: TAbstractFile | null | undefined): item is TFile | TFolder {
  return item instanceof TFile || item instanceof TFolder;
}

function getDraggedVaultItems(app: App): TAbstractFile[] {
  const draggable = (app as unknown as { dragManager?: { draggable?: ObsidianDraggable | null } })
    .dragManager?.draggable;
  const items = draggable?.files ?? (draggable?.file ? [draggable.file] : []);
  return items.filter(isVaultItem);
}

function getOsPath(file: File): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is absent on mobile, where dropped and picked files have no OS path
    const electron = require("electron") as {
      webUtils?: { getPathForFile?: (file: File) => string };
    };
    return electron.webUtils?.getPathForFile?.(file) || null;
  } catch {
    return null;
  }
}

function findVaultItem(app: App, file: File): TFile | TFolder | null {
  const osPath = getOsPath(file);
  if (!osPath) return null;
  const item = app.vault.getAbstractFileByPath(toVaultRelative(osPath, getVaultBase(app)));
  return isVaultItem(item) ? item : null;
}

// WeChat sends a dropped file's name as text beside the file, so a drag from inside Obsidian is recognized by Obsidian's
// drag manager, never by the drop's text, and every part of a drop is kept. https://github.com/Brevilabs/obsidian-copilot-private/issues/898
export function splitByVault(app: App, data: IncomingFiles): VaultSplit {
  const vaultItems = new Map<string, TAbstractFile>();
  for (const item of getDraggedVaultItems(app)) vaultItems.set(item.path, item);
  const entries = Array.from(data.items ?? []).filter((item) => item.kind === "file");
  const outsideFiles: File[] = [];
  const outsideFolderNames: string[] = [];
  Array.from(data.files).forEach((file, index) => {
    const inVault = findVaultItem(app, file);
    if (inVault) vaultItems.set(inVault.path, inVault);
    else if (entries[index]?.webkitGetAsEntry()?.isDirectory) outsideFolderNames.push(file.name);
    else outsideFiles.push(file);
  });
  return { vaultItems: [...vaultItems.values()], outsideFiles, outsideFolderNames };
}
