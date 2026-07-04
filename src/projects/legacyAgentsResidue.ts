import { logError, logInfo } from "@/logger";
import {
  AGENTS_MIRROR_FILE,
  COPILOT_PROJECT_ID,
  PROJECT_CONFIG_FILE_NAME,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import { getProjectsFolder } from "@/projects/projectPaths";
import { addPendingFileWrite, removePendingFileWrite } from "@/projects/state";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, parseYaml, TFile, TFolder } from "obsidian";

/**
 * One-time, dev-only cleanup of the unreleased PR2b-1 rename residue.
 *
 * PR2b-1 (never released) renamed a project's config to `AGENTS.md` (frontmatter + body).
 * The released model — restored in Phase 2 — keeps `project.md` as the single source of truth
 * and treats `AGENTS.md` as a generated, body-only mirror. Without this reconcile, a dev vault
 * whose config lives in `AGENTS.md` (and has no `project.md`) would stop being recognized.
 *
 * For each such folder we copy the `AGENTS.md` content into `project.md` FIRST (zero data loss —
 * the source is never removed before the new copy exists), then drop the config-laden
 * `AGENTS.md`. The post-load mirror batch regenerates a clean, marker'd body-only mirror from
 * the new `project.md`. Real users never hit this state, so it is best-effort and silent.
 */
export async function reconcileLegacyAgentsResidue(app: App): Promise<void> {
  const projectsFolder = getProjectsFolder();
  let folderPaths: string[];
  try {
    folderPaths = await listProjectSubfolders(app, projectsFolder);
  } catch (error) {
    logError("[Projects] Failed to scan for PR2b-1 AGENTS.md residue", error);
    return;
  }

  for (const folderPath of folderPaths) {
    const folderName = folderPath.split("/").pop() ?? "";
    if (folderName === PROJECTS_UNSUPPORTED_FOLDER_NAME) continue;

    const agentsPath = normalizePath(`${folderPath}/${AGENTS_MIRROR_FILE}`);
    const projectMdPath = normalizePath(`${folderPath}/${PROJECT_CONFIG_FILE_NAME}`);

    try {
      if (!(await fileExists(app, agentsPath))) continue;
      // project.md already present → not residue; AGENTS.md is (or will become) a mirror.
      if (await fileExists(app, projectMdPath)) continue;

      const content = await readFile(app, agentsPath);
      // Only adopt a PR2b-1 config (has copilot-project-id); leave a user's AGENTS.md alone.
      if (content === null || !hasCopilotProjectId(content)) continue;

      addPendingFileWrite(projectMdPath);
      try {
        await createFile(app, projectMdPath, content);
      } finally {
        removePendingFileWrite(projectMdPath);
      }

      addPendingFileWrite(agentsPath);
      try {
        await deleteFile(app, agentsPath);
      } finally {
        removePendingFileWrite(agentsPath);
      }

      logInfo(`[Projects] Reconciled PR2b-1 AGENTS.md residue → project.md in ${folderPath}`);
    } catch (error) {
      logError(`[Projects] Failed to reconcile AGENTS.md residue in ${folderPath}`, error);
    }
  }
}

/** True when the file's frontmatter carries a non-empty `copilot-project-id`. */
function hasCopilotProjectId(content: string): boolean {
  const fmMatch = content.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return false;
  try {
    const parsed = parseYaml(fmMatch[1]);
    if (!parsed || typeof parsed !== "object") return false;
    const id = (parsed as Record<string, unknown>)[COPILOT_PROJECT_ID];
    return typeof id === "string" ? id.trim().length > 0 : typeof id === "number";
  } catch {
    return false;
  }
}

/** List immediate sub-folder paths of `projectsFolder` (vault cache, adapter fallback). */
async function listProjectSubfolders(app: App, projectsFolder: string): Promise<string[]> {
  const root = app.vault.getAbstractFileByPath(projectsFolder);
  if (root instanceof TFolder) {
    return root.children.filter((c): c is TFolder => c instanceof TFolder).map((c) => c.path);
  }
  if (await app.vault.adapter.exists(projectsFolder)) {
    const listing = await app.vault.adapter.list(projectsFolder);
    return listing.folders;
  }
  return [];
}

async function fileExists(app: App, path: string): Promise<boolean> {
  if (app.vault.getAbstractFileByPath(path) instanceof TFile) return true;
  return app.vault.adapter.exists(path);
}

async function readFile(app: App, path: string): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) return app.vault.read(file);
  if (await app.vault.adapter.exists(path)) return app.vault.adapter.read(path);
  return null;
}

async function createFile(app: App, path: string, content: string): Promise<void> {
  const folderPath = normalizePath(path.split("/").slice(0, -1).join("/"));
  if (app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
    await app.vault.create(path, content);
  } else {
    await app.vault.adapter.write(path, content);
  }
}

async function deleteFile(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await trashFile(app, file);
  } else if (await app.vault.adapter.exists(path)) {
    await app.vault.adapter.remove(path);
  }
}
