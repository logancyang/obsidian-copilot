import { logError, logInfo } from "@/logger";
import { COPILOT_SUBFOLDER } from "@/settings/copilotFolder";
import { normalizePath, type DataAdapter } from "obsidian";

type FolderAdapter = Pick<DataAdapter, "exists" | "stat" | "list" | "rename" | "mkdir">;

interface MoveResult {
  moved: number;
  leftBehind: string[];
}

export type HiddenFolderMigration =
  | { status: "moved"; from: string; to: string; leftBehind: string[] }
  | { status: "failed"; from: string; to: string; reason: string };

export async function revealHiddenCopilotFolder(
  vault: { adapter: FolderAdapter },
  loadedFolder: unknown,
  visibleFolder: string
): Promise<HiddenFolderMigration | null> {
  if (typeof loadedFolder !== "string") return null;
  const hiddenFolder = normalizePath(loadedFolder.trim()).replace(/\/+$/, "");
  if (!hiddenFolder.split("/").some((segment) => segment.startsWith("."))) return null;

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
    return {
      status: "moved",
      from: hiddenFolder,
      to: visibleFolder,
      leftBehind: result.leftBehind,
    };
  } catch (error) {
    logError(`Failed to move the hidden Copilot folder ${hiddenFolder}.`, error);
    return {
      status: "failed",
      from: hiddenFolder,
      to: visibleFolder,
      reason: error instanceof Error ? error.message : String(error),
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
    const segments = to.split("/").slice(0, -1);
    for (let depth = 1; depth <= segments.length; depth++) {
      const ancestor = segments.slice(0, depth).join("/");
      if (!(await adapter.exists(ancestor))) await adapter.mkdir(ancestor);
    }
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
