import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logWarn } from "@/logger";
import { getSettings, type CopilotSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { normalizePath, type Vault } from "obsidian";

export const COPILOT_SUBFOLDER = Object.freeze({
  conversations: "copilot-conversations",
  customPrompts: "copilot-custom-prompts",
  systemPrompts: "system-prompts",
  skills: "skills",
  memory: "memory",
  projects: "projects",
} as const);

type FolderSettings = Pick<CopilotSettings, "copilotFolder">;

function copilotRoot(settings: FolderSettings): string {
  return (settings.copilotFolder || "").trim() || DEFAULT_COPILOT_FOLDER;
}

function deriveSubfolder(settings: FolderSettings, subfolder: string): string {
  return normalizePath(`${copilotRoot(settings)}/${subfolder}`);
}

export function deriveConversationsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.conversations);
}

export function deriveConversationAttachmentsFolder(conversationsFolder: string): string {
  return normalizePath(`${conversationsFolder}/attachments`);
}

export function deriveCustomPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.customPrompts);
}

export function deriveSystemPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.systemPrompts);
}

export function deriveSkillsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.skills);
}

export function deriveMemoryFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.memory);
}

export function deriveProjectsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.projects);
}

export function getEffectiveCopilotFolder(): string {
  return normalizePath(copilotRoot(getSettings()));
}

export function getEffectiveConversationsFolder(): string {
  return deriveConversationsFolder(getSettings());
}

export function getEffectiveCustomPromptsFolder(): string {
  return deriveCustomPromptsFolder(getSettings());
}

export function getEffectiveSystemPromptsFolder(): string {
  return deriveSystemPromptsFolder(getSettings());
}

export function getEffectiveSkillsFolder(): string {
  return deriveSkillsFolder(getSettings());
}

export function getEffectiveMemoryFolder(): string {
  return deriveMemoryFolder(getSettings());
}

export function getEffectiveProjectsFolder(): string {
  return deriveProjectsFolder(getSettings());
}

export async function ensureCopilotSubfolders(
  vault: Vault,
  settings: FolderSettings
): Promise<void> {
  const derivers = [
    deriveConversationsFolder,
    deriveCustomPromptsFolder,
    deriveSystemPromptsFolder,
    deriveSkillsFolder,
    deriveMemoryFolder,
    deriveProjectsFolder,
  ];
  for (const derive of derivers) {
    const folder = derive(settings);
    try {
      await ensureFolderExists(vault, folder);
    } catch (error) {
      logWarn(`Could not pre-create Copilot sub-folder "${folder}".`, error);
    }
  }
}
