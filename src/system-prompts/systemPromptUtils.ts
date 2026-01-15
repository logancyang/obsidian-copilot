import {
  COPILOT_SYSTEM_PROMPT_CREATED,
  COPILOT_SYSTEM_PROMPT_MODIFIED,
  COPILOT_SYSTEM_PROMPT_LAST_USED,
  COPILOT_SYSTEM_PROMPT_DEFAULT,
  EMPTY_SYSTEM_PROMPT,
} from "@/system-prompts/constants";
import { UserSystemPrompt } from "@/system-prompts/type";
import { normalizePath, TAbstractFile, TFile } from "obsidian";
import { getSettings } from "@/settings/model";
import { stripFrontmatter } from "@/utils";
import {
  updateCachedSystemPrompts,
  addPendingFileWrite,
  removePendingFileWrite,
  isPendingFileWrite,
} from "./state";
import { logWarn } from "@/logger";

/**
 * Validate a system prompt name
 */
export function validatePromptName(
  name: string,
  prompts: UserSystemPrompt[],
  currentPromptName?: string
): string | null {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return "Prompt name cannot be empty";
  }

  if (name !== trimmedName) {
    return "Prompt name cannot have leading or trailing spaces";
  }

  if (currentPromptName && name === currentPromptName) {
    return null; // No change needed
  }

  // eslint-disable-next-line no-control-regex
  const invalidChars = /[#<>:"/\\|?*[\]^\x00-\x1F]/g;
  if (invalidChars.test(trimmedName)) {
    return 'Prompt name contains invalid characters. Avoid using: < > : " / \\ | ? * [ ] ^';
  }

  if (prompts.some((p) => p.title.toLowerCase() === trimmedName.toLowerCase())) {
    return "A prompt with this name already exists";
  }

  return null;
}

/**
 * Get the system prompts folder path from settings
 */
export function getSystemPromptsFolder(): string {
  return normalizePath(getSettings().userSystemPromptsFolder);
}

/**
 * Get the file path for a system prompt by title
 */
export function getPromptFilePath(title: string): string {
  return normalizePath(`${getSystemPromptsFolder()}/${title}.md`);
}

/**
 * Get the file path for a system prompt by title in a specific folder
 * @param title - The title of the prompt
 * @param folder - Optional folder path (defaults to current settings folder)
 */
export function getPromptFilePathInFolder(title: string, folder?: string): string {
  const folderPath = folder ? normalizePath(folder) : getSystemPromptsFolder();
  return normalizePath(`${folderPath}/${title}.md`);
}

/**
 * Check if a file is a markdown file in the system prompts folder
 * Excludes files in the unsupported/ subfolder
 * Returns type guard for TFile to enable type narrowing
 */
export function isSystemPromptFile(file: TAbstractFile): file is TFile {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;
  const folder = getSystemPromptsFolder();
  if (!file.path.startsWith(folder + "/")) return false;

  // Exclude files in unsupported/ subfolder (for failed migrations)
  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.startsWith("unsupported/")) return false;

  // Allow direct children only (no other subfolders)
  if (relativePath.includes("/")) return false;

  return true;
}

/**
 * Coerce a frontmatter value into a finite number
 * Handles cases where YAML parser returns string instead of number
 */
function coerceFrontmatterNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Parse a TFile as a UserSystemPrompt by reading its content and extracting frontmatter
 */
export async function parseSystemPromptFile(file: TFile): Promise<UserSystemPrompt> {
  const rawContent = await app.vault.read(file);
  const content = stripFrontmatter(rawContent);
  const metadata = app.metadataCache.getFileCache(file);
  const frontmatter = metadata?.frontmatter;

  const createdMs = coerceFrontmatterNumber(
    frontmatter?.[COPILOT_SYSTEM_PROMPT_CREATED],
    EMPTY_SYSTEM_PROMPT.createdMs
  );
  const modifiedMs = coerceFrontmatterNumber(
    frontmatter?.[COPILOT_SYSTEM_PROMPT_MODIFIED],
    EMPTY_SYSTEM_PROMPT.modifiedMs
  );
  const lastUsedMs = coerceFrontmatterNumber(
    frontmatter?.[COPILOT_SYSTEM_PROMPT_LAST_USED],
    EMPTY_SYSTEM_PROMPT.lastUsedMs
  );

  return {
    title: file.basename,
    content,
    createdMs,
    modifiedMs,
    lastUsedMs,
  };
}

/**
 * Fetch all system prompts from the vault without updating cache
 * Use this when you need to control cache updates yourself (e.g., for latest-wins semantics)
 */
export async function fetchAllSystemPrompts(): Promise<UserSystemPrompt[]> {
  const files = app.vault.getFiles().filter((file) => isSystemPromptFile(file));
  return await Promise.all(files.map(parseSystemPromptFile));
}

/**
 * Load all system prompts from the vault and update cache
 */
export async function loadAllSystemPrompts(): Promise<UserSystemPrompt[]> {
  const prompts = await fetchAllSystemPrompts();
  updateCachedSystemPrompts(prompts);
  return prompts;
}

/**
 * Ensures that the required frontmatter fields exist on the given file.
 * Only adds missing fields, does not overwrite existing values.
 * This is idempotent and does not touch the file content.
 */
export async function ensurePromptFrontmatter(file: TFile, prompt: UserSystemPrompt) {
  // Check if already pending to avoid nested add/remove issues
  const alreadyPending = isPendingFileWrite(file.path);
  const now = Date.now();

  // Ensure valid timestamps with fallbacks
  const createdMs =
    Number.isFinite(prompt.createdMs) && prompt.createdMs > 0 ? prompt.createdMs : now;
  const modifiedMs =
    Number.isFinite(prompt.modifiedMs) && prompt.modifiedMs > 0 ? prompt.modifiedMs : now;
  const lastUsedMs =
    Number.isFinite(prompt.lastUsedMs) && prompt.lastUsedMs > 0 ? prompt.lastUsedMs : 0;

  try {
    if (!alreadyPending) {
      addPendingFileWrite(file.path);
    }
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] = createdMs;
      }
      if (frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] = modifiedMs;
      }
      if (frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] = lastUsedMs;
      }
    });
  } finally {
    if (!alreadyPending) {
      removePendingFileWrite(file.path);
    }
  }
}

/**
 * Update the last used timestamp for a system prompt
 */
export async function updatePromptLastUsed(title: string): Promise<void> {
  const filePath = getPromptFilePath(title);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  // Check if already pending to avoid nested add/remove issues
  const alreadyPending = isPendingFileWrite(file.path);

  try {
    if (!alreadyPending) {
      addPendingFileWrite(file.path);
    }
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] = Date.now();
    });
  } finally {
    if (!alreadyPending) {
      removePendingFileWrite(file.path);
    }
  }
}

/**
 * Generates a unique name for a copied prompt by adding "(copy)" or "(copy N)" suffix
 */
export function generateCopyPromptName(
  originalName: string,
  existingPrompts: UserSystemPrompt[]
): string {
  const baseName = `${originalName} (copy)`;
  let copyName = baseName;
  let counter = 1;

  // Check if the base copy name already exists
  while (existingPrompts.some((p) => p.title.toLowerCase() === copyName.toLowerCase())) {
    counter++;
    copyName = `${originalName} (copy ${counter})`;
  }

  return copyName;
}

/**
 * Update the default flag in a prompt file's frontmatter
 * @param title - The title of the prompt
 * @param isDefault - Whether to set or remove the default flag
 * @param folder - Optional folder path (defaults to current settings folder)
 */
export async function updatePromptDefaultFlag(
  title: string,
  isDefault: boolean,
  folder?: string
): Promise<void> {
  const filePath = getPromptFilePathInFolder(title, folder);
  const file = app.vault.getAbstractFileByPath(filePath);

  if (!(file instanceof TFile)) {
    logWarn(`System prompt file not found for default flag update: ${filePath}`);
    return;
  }

  const alreadyPending = isPendingFileWrite(file.path);
  try {
    if (!alreadyPending) {
      addPendingFileWrite(file.path);
    }
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (isDefault) {
        frontmatter[COPILOT_SYSTEM_PROMPT_DEFAULT] = true;
      } else {
        delete frontmatter[COPILOT_SYSTEM_PROMPT_DEFAULT];
      }
    });
  } finally {
    if (!alreadyPending) {
      removePendingFileWrite(file.path);
    }
  }
}
