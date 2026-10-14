import { logError, logInfo } from "@/logger";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { COPILOT_SUBFOLDER } from "@/settings/copilotFolder";
import { copilotFolderOverlapsConfigDir } from "@/settings/model";
import { normalizePath, type DataAdapter, type Vault } from "obsidian";

type FolderAdapter = Pick<DataAdapter, "exists" | "stat" | "list" | "rename" | "mkdir">;

interface MoveResult {
  moved: number;
  leftBehind: string[];
}

export async function revealHiddenCopilotFolder(
  vault: { adapter: FolderAdapter; configDir: Vault["configDir"] },
  loadedFolder: unknown,
  visibleFolder: string
): Promise<StartupMigrationItem | null> {
  if (typeof loadedFolder !== "string") return null;
  const hiddenFolder = normalizePath(loadedFolder.trim()).replace(/\/+$/, "");
  if (!hiddenFolder.split("/").some((segment) => segment.startsWith("."))) return null;
  if (copilotFolderOverlapsConfigDir(hiddenFolder, vault.configDir)) return null;

  const { adapter } = vault;
  try {
    if (!(await adapter.exists(hiddenFolder))) return null;
    const result: MoveResult = { moved: 0, leftBehind: [] };
    // `.copilot` also holds Copilot's caches, so only the folders Copilot reads from its root move into the vault.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/712
    for (const subfolder of Object.values(COPILOT_SUBFOLDER)) {
      const from = `${hiddenFolder}/${subfolder}`;
      if (await adapter.exists(from)) {
        await moveMerging(adapter, from, `${visibleFolder}/${subfolder}`, result);
      }
    }
    if (result.moved === 0 && result.leftBehind.length === 0) return null;

    logInfo(`Moved the hidden Copilot folder ${hiddenFolder} to ${visibleFolder}.`);
    if (result.leftBehind.length === 0) {
      return {
        id: "copilot-folder",
        title: "Copilot folder",
        status: "success",
        summary: `Moved ${hiddenFolder} to ${visibleFolder}. Copilot folders can no longer be hidden.`,
      };
    }
    return {
      id: "copilot-folder",
      title: "Copilot folder",
      status: "action-required",
      summary: `Moved ${hiddenFolder} to ${visibleFolder}, except files whose names already exist there. Copilot reads only ${visibleFolder}.`,
      details: result.leftBehind.map((path) => `Left in place: ${path}.`),
    };
  } catch (error) {
    logError(`Failed to move the hidden Copilot folder ${hiddenFolder}.`, error);
    return {
      id: "copilot-folder",
      title: "Copilot folder",
      status: "error",
      summary: `Could not move ${hiddenFolder} to ${visibleFolder}. Move its contents there to keep using them.`,
    };
  }
}

// A merge never overwrites: the visible folder may hold older files, and either copy could be the one the user wants.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/712
async function moveMerging(
  adapter: FolderAdapter,
  from: string,
  to: string,
  result: MoveResult
): Promise<void> {
  if (!(await adapter.exists(to))) {
    const parent = to.slice(0, Math.max(0, to.lastIndexOf("/")));
    if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
    await adapter.rename(from, to);
    result.moved++;
    return;
  }
  if (
    (await adapter.stat(from))?.type !== "folder" ||
    (await adapter.stat(to))?.type !== "folder"
  ) {
    result.leftBehind.push(from);
    return;
  }
  const { files, folders } = await adapter.list(from);
  for (const child of [...folders, ...files]) {
    await moveMerging(adapter, child, `${to}/${child.slice(child.lastIndexOf("/") + 1)}`, result);
  }
}
