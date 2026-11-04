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

let pendingInclusionsUpdate: Promise<unknown> = Promise.resolve();

export function getDraggedVaultItems(app: App): TAbstractFile[] {
  const draggable = (app as unknown as { dragManager?: { draggable?: ObsidianDraggable | null } })
    .dragManager?.draggable;
  const items = draggable?.files ?? (draggable?.file ? [draggable.file] : []);
  return items.filter((item) => item instanceof TFile || item instanceof TFolder);
}

function updateProjectInclusions(
  app: App,
  projectId: string,
  update: (patterns: readonly string[]) => string[]
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
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
  };
  // Each write starts from the cached project, so a second link or unlink waits for the first to land instead of
  // overwriting it with a stale list. https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  const result = pendingInclusionsUpdate.then(run);
  pendingInclusionsUpdate = result.catch(() => undefined);
  return result;
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
