import { AGENTS_FILE_NAME, ensureAgentsFile } from "@/instructions/agentsFile";
import { logInfo, logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectFolderPath } from "@/projects/projectPaths";
import type { ProjectFileRecord } from "@/projects/type";
import { resolveFileByPath } from "@/utils/vaultAdapterUtils";
import { App, normalizePath } from "obsidian";

/**
 * Move a project's instruction text out of `project.md` and into its `AGENTS.md`.
 *
 * `project.md` keeps what it is good at — the project's context metadata (folders, notes,
 * URLs) — while the instruction text moves to the file every Agent Mode backend already
 * discovers from the session working directory. Leaving it in `project.md` would keep two
 * sources of truth for the same instructions, one of which no backend reads.
 *
 * The move runs at most once per project: it needs prompt text to move AND no `AGENTS.md`
 * standing in its way, so a project that has already been moved (or whose instructions the
 * user wrote directly into `AGENTS.md`) is left alone. Never throws — a session must start
 * even when the vault refuses a write.
 *
 * @param app - Obsidian app that owns the target vault
 * @param record - The live project record; its `folderName` locates the files and its
 *   `systemPrompt` supplies the text to move
 */
export async function moveProjectPromptToAgentsFile(
  app: App,
  record: ProjectFileRecord
): Promise<void> {
  const promptText = record.project.systemPrompt ?? "";
  if (!promptText.trim()) return;

  try {
    const folderPath = getProjectFolderPath(record.folderName);
    // An existing AGENTS.md is the user's, and `ensureAgentsFile` will not overwrite it — so
    // clearing `project.md` here would delete the old text with nowhere to have put it.
    if (await resolveFileByPath(app, normalizePath(`${folderPath}/${AGENTS_FILE_NAME}`))) return;

    // Write first, clear second. The reverse order loses the text outright if the vault
    // rejects the AGENTS.md write.
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
