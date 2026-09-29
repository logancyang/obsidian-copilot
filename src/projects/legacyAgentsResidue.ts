import { AGENTS_FILE_NAME } from "@/instructions/agentsFile";
import { logError, logInfo } from "@/logger";
import {
  COPILOT_PROJECT_ID,
  PROJECT_CONFIG_FILE_NAME,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import { getProjectsFolder } from "@/projects/projectPaths";
import { addPendingFileWrite, removePendingFileWrite } from "@/projects/state";
import { stripFrontmatter } from "@/utils";
import { App, normalizePath, parseYaml, TFile, TFolder } from "obsidian";

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

    const agentsPath = normalizePath(`${folderPath}/${AGENTS_FILE_NAME}`);
    const projectMdPath = normalizePath(`${folderPath}/${PROJECT_CONFIG_FILE_NAME}`);

    try {
      if (!(await fileExists(app, agentsPath))) continue;
      if (await fileExists(app, projectMdPath)) continue;

      const content = await readFile(app, agentsPath);
      if (content === null || !hasCopilotProjectId(content)) continue;

      addPendingFileWrite(projectMdPath);
      try {
        await createFile(app, projectMdPath, content);
      } finally {
        removePendingFileWrite(projectMdPath);
      }

      const body = stripFrontmatter(content, { trimStart: false });
      if (body !== content) {
        addPendingFileWrite(agentsPath);
        try {
          await writeFile(app, agentsPath, body);
        } finally {
          removePendingFileWrite(agentsPath);
        }
      }

      logInfo(`[Projects] Reconciled PR2b-1 AGENTS.md residue → project.md in ${folderPath}`);
    } catch (error) {
      logError(`[Projects] Failed to reconcile AGENTS.md residue in ${folderPath}`, error);
    }
  }
}

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

async function writeFile(app: App, path: string, content: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
    return;
  }
  await app.vault.adapter.write(path, content);
}

async function createFile(app: App, path: string, content: string): Promise<void> {
  const folderPath = normalizePath(path.split("/").slice(0, -1).join("/"));
  if (app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
    await app.vault.create(path, content);
  } else {
    await app.vault.adapter.write(path, content);
  }
}
