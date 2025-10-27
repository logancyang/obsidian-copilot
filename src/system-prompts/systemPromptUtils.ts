import {
  COPILOT_SYSTEM_PROMPT_CREATED,
  COPILOT_SYSTEM_PROMPT_MODIFIED,
  COPILOT_SYSTEM_PROMPT_LAST_USED,
  EMPTY_SYSTEM_PROMPT,
} from "@/system-prompts/constants";
import { UserSystemPrompt } from "@/system-prompts/type";
import { normalizePath, TAbstractFile, TFile } from "obsidian";
import { getSettings } from "@/settings/model";
import { updateCachedSystemPrompts, addPendingFileWrite, removePendingFileWrite } from "./state";

/**
 * Validate a system prompt name
 */
export function validatePromptName(
  name: string,
  prompts: UserSystemPrompt[],
  currentPromptName?: string
): string | null {
  const trimmedName = name.trim();

  if (currentPromptName && trimmedName === currentPromptName) {
    return null; // No change is allowed
  }

  if (!trimmedName) {
    return "Prompt name cannot be empty";
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
  return `${getSystemPromptsFolder()}/${title}.md`;
}

/**
 * Check if a file is a markdown file in the system prompts folder
 */
export function isSystemPromptFile(file: TAbstractFile): boolean {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;
  const folder = getSystemPromptsFolder();
  if (!file.path.startsWith(folder + "/")) return false;
  // Only include direct children (no slashes in relative path)
  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.includes("/")) return false;
  return true;
}

/**
 * Utility to strip YAML frontmatter from markdown content
 */
function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) {
      return content.slice(end + 3).trimStart();
    }
  }
  return content;
}

/**
 * Parse a TFile as a UserSystemPrompt by reading its content and extracting frontmatter
 */
export async function parseSystemPromptFile(file: TFile): Promise<UserSystemPrompt> {
  const rawContent = await app.vault.read(file);
  const content = stripFrontmatter(rawContent);
  const metadata = app.metadataCache.getFileCache(file);
  const createdMs =
    metadata?.frontmatter?.[COPILOT_SYSTEM_PROMPT_CREATED] ?? EMPTY_SYSTEM_PROMPT.createdMs;
  const modifiedMs =
    metadata?.frontmatter?.[COPILOT_SYSTEM_PROMPT_MODIFIED] ?? EMPTY_SYSTEM_PROMPT.modifiedMs;
  const lastUsedMs =
    metadata?.frontmatter?.[COPILOT_SYSTEM_PROMPT_LAST_USED] ?? EMPTY_SYSTEM_PROMPT.lastUsedMs;

  return {
    title: file.basename,
    content,
    createdMs,
    modifiedMs,
    lastUsedMs,
  };
}

/**
 * Load all system prompts from the vault
 */
export async function loadAllSystemPrompts(): Promise<UserSystemPrompt[]> {
  const files = app.vault.getFiles().filter((file) => isSystemPromptFile(file));
  const prompts: UserSystemPrompt[] = await Promise.all(files.map(parseSystemPromptFile));
  updateCachedSystemPrompts(prompts);
  return prompts;
}

/**
 * Ensures that the required frontmatter fields exist on the given file.
 * Only adds missing fields, does not overwrite existing values.
 * This is idempotent and does not touch the file content.
 */
export async function ensurePromptFrontmatter(file: TFile, prompt: UserSystemPrompt) {
  try {
    addPendingFileWrite(file.path);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] = prompt.createdMs;
      }
      if (frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] = prompt.modifiedMs;
      }
      if (frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] == null) {
        frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] = prompt.lastUsedMs;
      }
    });
  } finally {
    removePendingFileWrite(file.path);
  }
}

/**
 * Update the last used timestamp for a system prompt
 */
export async function updatePromptLastUsed(title: string): Promise<void> {
  const filePath = getPromptFilePath(title);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  try {
    addPendingFileWrite(file.path);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] = Date.now();
    });
  } finally {
    removePendingFileWrite(file.path);
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
