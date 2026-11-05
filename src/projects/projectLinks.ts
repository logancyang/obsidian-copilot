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

let pendingInclusionsUpdate: Promise<unknown> = Promise.resolve();

function updateProjectInclusions(
  app: App,
  projectId: string,
  update: (patterns: readonly string[]) => string[]
): Promise<boolean> {
  // The project cache changes only after a save lands, so overlapping link or unlink actions would each start from
  // the same list and the later save would undo the earlier one. https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  const result = pendingInclusionsUpdate.then(() => writeInclusions(app, projectId, update));
  pendingInclusionsUpdate = result.catch(() => undefined);
  return result;
}

async function writeInclusions(
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
  return updateProjectInclusions(app, projectId, (patterns) => [...patterns, ...added]);
}

export function unlinkProjectPattern(
  app: App,
  projectId: string,
  pattern: string
): Promise<boolean> {
  return updateProjectInclusions(app, projectId, (patterns) =>
    patterns.filter((p) => p !== pattern)
  );
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

export async function copyIntoProjectSources(
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
