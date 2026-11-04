import { PROJECT_SOURCES_FOLDER_NAME } from "@/projects/constants";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getFilePattern,
} from "@/search/searchUtils";
import type { ProjectConfig } from "@/aiParams";
import { parseProjectUrls, serializeProjectUrls, type UrlItem } from "@/lib/url-tag";
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

type ContextSource = ProjectConfig["contextSource"];

let pendingContextSourceUpdate: Promise<unknown> = Promise.resolve();

function updateContextSource(
  app: App,
  projectId: string,
  update: (contextSource: ContextSource) => Partial<ContextSource> | null
): Promise<boolean> {
  // The project cache changes only after a save lands, so overlapping link or unlink actions would each start from
  // the same list and the later save would undo the earlier one. https://github.com/Brevilabs/obsidian-copilot-private/issues/461
  const result = pendingContextSourceUpdate.then(() => writeContextSource(app, projectId, update));
  pendingContextSourceUpdate = result.catch(() => undefined);
  return result;
}

async function writeContextSource(
  app: App,
  projectId: string,
  update: (contextSource: ContextSource) => Partial<ContextSource> | null
): Promise<boolean> {
  const project = getCachedProjectRecordById(projectId)?.project;
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const changes = update(project.contextSource ?? {});
  if (!changes) return false;
  await ProjectFileManager.getInstance(app).updateProject(projectId, {
    ...project,
    contextSource: { ...project.contextSource, ...changes },
  });
  return true;
}

function updateProjectInclusions(
  app: App,
  projectId: string,
  update: (patterns: readonly string[]) => string[]
): Promise<boolean> {
  return updateContextSource(app, projectId, (contextSource) => {
    const patterns = [...new Set(getDecodedPatterns(contextSource.inclusions ?? ""))];
    const next = [...new Set(update(patterns))];
    if (next.length === patterns.length && next.every((pattern, i) => pattern === patterns[i])) {
      return null;
    }
    return { inclusions: createPatternSettingsValue(categorizePatterns(next)) };
  });
}

function updateProjectUrls(
  app: App,
  projectId: string,
  update: (items: readonly UrlItem[]) => UrlItem[]
): Promise<boolean> {
  return updateContextSource(app, projectId, ({ webUrls = "", youtubeUrls = "" }) => {
    const items = parseProjectUrls(webUrls, youtubeUrls);
    const next = serializeProjectUrls(update(items));
    const current = serializeProjectUrls(items);
    if (next.webUrls === current.webUrls && next.youtubeUrls === current.youtubeUrls) return null;
    return next;
  });
}

export function linkProjectItems(
  app: App,
  projectId: string,
  items: readonly TAbstractFile[]
): Promise<boolean> {
  const added = items.map((item) => (item instanceof TFile ? getFilePattern(item) : item.path));
  return updateProjectInclusions(app, projectId, (patterns) => [...patterns, ...added]);
}

export function linkProjectPattern(app: App, projectId: string, pattern: string): Promise<boolean> {
  return updateProjectInclusions(app, projectId, (patterns) => [...patterns, pattern]);
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

export function linkProjectUrl(app: App, projectId: string, item: UrlItem): Promise<boolean> {
  return updateProjectUrls(app, projectId, (items) => [...items, item]);
}

export function unlinkProjectUrl(app: App, projectId: string, item: UrlItem): Promise<boolean> {
  return updateProjectUrls(app, projectId, (items) => items.filter((u) => u.id !== item.id));
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
