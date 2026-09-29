import {
  COPILOT_SYSTEM_PROMPT_CREATED,
  COPILOT_SYSTEM_PROMPT_MODIFIED,
  COPILOT_SYSTEM_PROMPT_LAST_USED,
  COPILOT_SYSTEM_PROMPT_DEFAULT,
  EMPTY_SYSTEM_PROMPT,
} from "@/system-prompts/constants";
import { UserSystemPrompt } from "@/system-prompts/type";
import { App, normalizePath, TAbstractFile, TFile } from "obsidian";
import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
import { stripFrontmatter } from "@/utils";
import {
  updateCachedSystemPrompts,
  addPendingFileWrite,
  removePendingFileWrite,
  isPendingFileWrite,
} from "./state";
import { logWarn } from "@/logger";

export function getSystemPromptsFolder(): string {
  return getEffectiveSystemPromptsFolder();
}

export function getPromptFilePath(title: string): string {
  return normalizePath(`${getSystemPromptsFolder()}/${title}.md`);
}

export function getPromptFilePathInFolder(title: string, folder?: string): string {
  const folderPath = folder ? normalizePath(folder) : getSystemPromptsFolder();
  return normalizePath(`${folderPath}/${title}.md`);
}

export function isSystemPromptFile(file: TAbstractFile): file is TFile {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;
  const folder = getSystemPromptsFolder();
  if (!file.path.startsWith(folder + "/")) return false;

  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.startsWith("unsupported/")) return false;

  if (relativePath.includes("/")) return false;

  return true;
}

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

export async function parseSystemPromptFile(app: App, file: TFile): Promise<UserSystemPrompt> {
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

export async function fetchAllSystemPrompts(app: App): Promise<UserSystemPrompt[]> {
  const files = app.vault.getFiles().filter((file) => isSystemPromptFile(file));
  return await Promise.all(files.map((file) => parseSystemPromptFile(app, file)));
}

export async function loadAllSystemPrompts(app: App): Promise<UserSystemPrompt[]> {
  const prompts = await fetchAllSystemPrompts(app);
  updateCachedSystemPrompts(prompts);
  return prompts;
}

export async function ensurePromptFrontmatter(app: App, file: TFile, prompt: UserSystemPrompt) {
  const alreadyPending = isPendingFileWrite(file.path);
  const now = Date.now();

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
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
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

export async function updatePromptDefaultFlag(
  app: App,
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
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
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
