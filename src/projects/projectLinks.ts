import type { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getFilePattern,
} from "@/search/searchUtils";
import { App, TAbstractFile, TFile } from "obsidian";

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
