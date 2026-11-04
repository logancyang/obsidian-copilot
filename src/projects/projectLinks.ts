import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getFilePattern,
} from "@/search/searchUtils";
import { App, TAbstractFile, TFile } from "obsidian";

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
