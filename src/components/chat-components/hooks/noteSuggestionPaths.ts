import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { deriveCopilotFolder, deriveProjectsFolder } from "@/settings/copilotFolder";
import type { CopilotSettings } from "@/settings/model";

// The Copilot folder holds Copilot's working files; only the user's own project files are offered.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/961
export function isSuggestedVaultPath(
  path: string,
  settings: Pick<CopilotSettings, "copilotFolder">
): boolean {
  const copilotFolder = deriveCopilotFolder(settings);
  if (path !== copilotFolder && !path.startsWith(`${copilotFolder}/`)) return true;

  const projectsFolder = deriveProjectsFolder(settings);
  if (path === projectsFolder) return true;
  if (!path.startsWith(`${projectsFolder}/`)) return false;

  const [projectFolder, ...rest] = path.slice(projectsFolder.length + 1).split("/");
  if (projectFolder === PROJECTS_UNSUPPORTED_FOLDER_NAME) return false;
  return !(rest.length === 1 && rest[0] === PROJECT_CONFIG_FILE_NAME);
}
