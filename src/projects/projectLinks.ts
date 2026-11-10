import type { ProjectConfig } from "@/aiParams";
import { PROJECT_SOURCES_FOLDER_NAME } from "@/projects/constants";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getFilePattern,
} from "@/search/searchUtils";
import { ensureFolderExists } from "@/utils";
import { App, TAbstractFile, TFile, TFolder } from "obsidian";

interface ObsidianDraggable {
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

export function getDraggedVaultItems(app: App): TAbstractFile[] {
  const draggable = (app as unknown as { dragManager?: { draggable?: ObsidianDraggable | null } })
    .dragManager?.draggable;
  const items = draggable?.files ?? (draggable?.file ? [draggable.file] : []);
  return items.filter((item) => item instanceof TFile || item instanceof TFolder);
}

interface OutsideDrop {
  files: File[];
  folderNames: string[];
}

export function splitOutsideDrop(dataTransfer: {
  files: ArrayLike<File>;
  items?: ArrayLike<DataTransferItem>;
}): OutsideDrop {
  const entries = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
  const drop: OutsideDrop = { files: [], folderNames: [] };
  Array.from(dataTransfer.files).forEach((file, index) => {
    if (entries[index]?.webkitGetAsEntry()?.isDirectory) drop.folderNames.push(file.name);
    else drop.files.push(file);
  });
  return drop;
}

export interface ProjectLinks {
  folders: readonly string[];
  notes: readonly string[];
}

const NO_LINKS: ProjectLinks = Object.freeze({
  folders: Object.freeze([]),
  notes: Object.freeze([]),
});

export function getProjectLinks(project: ProjectConfig | undefined): ProjectLinks {
  const { folderPatterns, notePatterns } = categorizePatterns([
    ...new Set(getDecodedPatterns(project?.contextSource?.inclusions ?? "")),
  ]);
  if (folderPatterns.length + notePatterns.length === 0) return NO_LINKS;
  return { folders: folderPatterns, notes: notePatterns };
}

let pendingLinksUpdate: Promise<unknown> = Promise.resolve();

function updateProjectLinks(
  app: App,
  projectId: string,
  update: (patterns: readonly string[]) => string[]
): Promise<boolean> {
  // The project cache changes only after a save lands, so overlapping link or unlink actions would each start from
  // the same list and the later save would undo the earlier one. https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  const result = pendingLinksUpdate.then(() => writeLinks(app, projectId, update));
  pendingLinksUpdate = result.catch(() => undefined);
  return result;
}

async function writeLinks(
  app: App,
  projectId: string,
  update: (patterns: readonly string[]) => string[]
): Promise<boolean> {
  const project = getCachedProjectRecordById(projectId)?.project;
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const patterns = [...new Set(getDecodedPatterns(project.contextSource?.inclusions ?? ""))];
  const next = [...new Set(update(patterns))];
  if (next.length === patterns.length && next.every((pattern, i) => pattern === patterns[i])) {
    return false;
  }
  const inclusions = createPatternSettingsValue(categorizePatterns(next));
  await ProjectFileManager.getInstance(app).updateProject(projectId, {
    ...project,
    contextSource: { ...project.contextSource, inclusions },
  });
  return true;
}

export function linkProjectItems(
  app: App,
  projectId: string,
  items: readonly TAbstractFile[]
): Promise<boolean> {
  const added = items.map((item) => (item instanceof TFile ? getFilePattern(item) : item.path));
  return updateProjectLinks(app, projectId, (patterns) => [...patterns, ...added]);
}

export function unlinkProjectPattern(
  app: App,
  projectId: string,
  pattern: string
): Promise<boolean> {
  return updateProjectLinks(app, projectId, (patterns) => patterns.filter((p) => p !== pattern));
}

async function getAvailablePath(app: App, folderPath: string, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  let path = `${folderPath}/${fileName}`;
  // A file dropped from the computer must never replace one already in sources/, so a taken name gets a number.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  for (let n = 1; await app.vault.adapter.exists(path); n++) {
    path = `${folderPath}/${stem} ${n}${extension}`;
  }
  return path;
}

let pendingSourcesCopy: Promise<unknown> = Promise.resolve();

export function copyIntoProjectSources(
  app: App,
  projectFolderPath: string,
  files: readonly File[]
): Promise<TFile[]> {
  // Overlapping drops of same-named files would each pick the same free name, and the later write would fail.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  const result = pendingSourcesCopy.then(() => copyFiles(app, projectFolderPath, files));
  pendingSourcesCopy = result.catch(() => undefined);
  return result;
}

async function copyFiles(
  app: App,
  projectFolderPath: string,
  files: readonly File[]
): Promise<TFile[]> {
  const folderPath = `${projectFolderPath}/${PROJECT_SOURCES_FOLDER_NAME}`;
  await ensureFolderExists(app.vault, folderPath);
  const copies: TFile[] = [];
  for (const file of files) {
    const path = await getAvailablePath(app, folderPath, file.name);
    copies.push(await app.vault.createBinary(path, await file.arrayBuffer()));
  }
  return copies;
}
