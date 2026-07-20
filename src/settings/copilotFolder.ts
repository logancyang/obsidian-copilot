import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logWarn } from "@/logger";
import { getSettings, type CopilotSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { normalizePath, type Vault } from "obsidian";

/**
 * Fixed sub-folder names every Copilot data folder derives from the single
 * configurable `copilotFolder` root. These names are the historical hardcoded
 * defaults (byte-for-byte), so a default vault (`copilotFolder === "copilot"`)
 * resolves to exactly the same paths it used before the root became configurable.
 */
export const COPILOT_SUBFOLDER = Object.freeze({
  conversations: "copilot-conversations",
  customPrompts: "copilot-custom-prompts",
  systemPrompts: "system-prompts",
  skills: "skills",
  memory: "memory",
  projects: "projects",
} as const);

/** Settings shape the derivation helpers depend on. */
type FolderSettings = Pick<CopilotSettings, "copilotFolder">;

/**
 * Resolve the configurable root all sub-folders derive from.
 *
 * Reason: the loader's `sanitizeSettings` guarantees a non-empty, traversal-free
 * root, but the UI can render before settings hydration completes. Falling back
 * to the default in that window keeps derived paths well-formed rather than
 * producing a leading-slash path. Mirrors `SkillManager.resolveSkillsFolder`.
 */
function copilotRoot(settings: FolderSettings): string {
  return (settings.copilotFolder || "").trim() || DEFAULT_COPILOT_FOLDER;
}

/** Join the resolved root with a fixed sub-folder name into a normalized path. */
function deriveSubfolder(settings: FolderSettings, subfolder: string): string {
  return normalizePath(`${copilotRoot(settings)}/${subfolder}`);
}

/**
 * Derive the chat-conversations folder from a settings snapshot.
 * Pure: callers (e.g. watchers comparing prev/next) pass the snapshot they hold
 * instead of reading the global store mid-operation.
 */
export function deriveConversationsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.conversations);
}

/** Derive the custom-commands folder from a settings snapshot. */
export function deriveCustomPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.customPrompts);
}

/** Derive the user system-prompts folder from a settings snapshot. */
export function deriveSystemPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.systemPrompts);
}

/** Derive the agent skills folder from a settings snapshot. */
export function deriveSkillsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.skills);
}

/** Derive the user-memory folder from a settings snapshot. */
export function deriveMemoryFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.memory);
}

/** Derive the projects folder from a settings snapshot. */
export function deriveProjectsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, COPILOT_SUBFOLDER.projects);
}

/**
 * Effective root folder for artifacts written directly under it (e.g. the log
 * file and index-inspection notes), not into one of the derived sub-folders.
 */
export function getEffectiveCopilotFolder(): string {
  return normalizePath(copilotRoot(getSettings()));
}

/** Effective chat-conversations folder derived from the current global settings. */
export function getEffectiveConversationsFolder(): string {
  return deriveConversationsFolder(getSettings());
}

/** Effective custom-commands folder derived from the current global settings. */
export function getEffectiveCustomPromptsFolder(): string {
  return deriveCustomPromptsFolder(getSettings());
}

/** Effective user system-prompts folder derived from the current global settings. */
export function getEffectiveSystemPromptsFolder(): string {
  return deriveSystemPromptsFolder(getSettings());
}

/** Effective agent skills folder derived from the current global settings. */
export function getEffectiveSkillsFolder(): string {
  return deriveSkillsFolder(getSettings());
}

/** Effective user-memory folder derived from the current global settings. */
export function getEffectiveMemoryFolder(): string {
  return deriveMemoryFolder(getSettings());
}

/** Effective projects folder derived from the current global settings. */
export function getEffectiveProjectsFolder(): string {
  return deriveProjectsFolder(getSettings());
}

/**
 * Pre-create every derived Copilot sub-folder under the current root so the
 * locations the relocation/change-root notices point at already exist when the
 * user goes to move files into them (Obsidian's own move dialog creates missing
 * targets, but a user moving files from the OS file manager needs them present).
 *
 * Best-effort and idempotent: {@link ensureFolderExists} skips folders that
 * already exist, and a per-folder failure (e.g. a file already occupies the
 * path) is logged and skipped rather than aborting the rest.
 *
 * @param vault - Active vault, threaded in (never the global `app`).
 * @param settings - Settings snapshot whose `copilotFolder` roots the derivation.
 */
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
