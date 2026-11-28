import { agentsFileIsUninitialized, ensureAgentsFile } from "@/instructions/agentsFile";
import { logInfo, logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import type { ProjectFileRecord } from "@/projects/type";
import { App } from "obsidian";

export async function moveProjectPromptToAgentsFile(
  app: App,
  record: ProjectFileRecord
): Promise<void> {
  const promptText = record.project.systemPrompt ?? "";
  if (!promptText.trim()) return;

  try {
    const folderPath = getProjectAnchorFromConfigPath(record.filePath).projectFolderPath;
    if (!(await agentsFileIsUninitialized(app, folderPath))) return;

    await ensureAgentsFile(app, folderPath, promptText);
    await ProjectFileManager.getInstance(app).updateProject(record.project.id, {
      ...record.project,
      systemPrompt: "",
    });
    logInfo(`[Projects] Moved project instructions into ${folderPath}/AGENTS.md`);
  } catch (error) {
    logWarn(`[Projects] Failed to move project instructions for "${record.folderName}"`, error);
  }
}
