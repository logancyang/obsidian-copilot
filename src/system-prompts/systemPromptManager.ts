import { TFile, Vault } from "obsidian";
import { UserSystemPrompt } from "@/system-prompts/type";
import {
  ensurePromptFrontmatter,
  generateCopyPromptName,
  getPromptFilePath,
  getSystemPromptsFolder,
  loadAllSystemPrompts,
  validatePromptName,
} from "@/system-prompts/systemPromptUtils";
import {
  getCachedSystemPrompts,
  upsertCachedSystemPrompt,
  deleteCachedSystemPrompt,
  addPendingFileWrite,
  removePendingFileWrite,
} from "@/system-prompts/state";
import { COPILOT_SYSTEM_PROMPT_MODIFIED } from "@/system-prompts/constants";
import { logInfo } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { getSettings, updateSetting } from "@/settings/model";

/**
 * Singleton manager for system prompts
 * Provides centralized CRUD operations for system prompts
 */
export class SystemPromptManager {
  private static instance: SystemPromptManager;
  private vault: Vault;

  private constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(vault?: Vault): SystemPromptManager {
    if (!SystemPromptManager.instance) {
      if (!vault) {
        throw new Error("Vault is required for first initialization");
      }
      SystemPromptManager.instance = new SystemPromptManager(vault);
    }
    return SystemPromptManager.instance;
  }

  /**
   * Initialize the manager by loading all prompts
   */
  public async initialize(): Promise<void> {
    logInfo("Initializing SystemPromptManager");
    await loadAllSystemPrompts();
  }

  /**
   * Create a new system prompt
   * @param prompt - The system prompt to create
   * @param skipStoreUpdate - If true, skip updating the cache (useful for batch operations)
   */
  public async createPrompt(prompt: UserSystemPrompt, skipStoreUpdate = false): Promise<void> {
    const existingPrompts = getCachedSystemPrompts();
    const error = validatePromptName(prompt.title, existingPrompts);

    if (error) {
      throw new Error(error);
    }

    const filePath = getPromptFilePath(prompt.title);
    const folderPath = getSystemPromptsFolder();

    try {
      addPendingFileWrite(filePath);

      // Ensure nested folders are created cross-platform
      await ensureFolderExists(folderPath);

      // Create the file
      await this.vault.create(filePath, prompt.content);

      // Add frontmatter
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await ensurePromptFrontmatter(file, prompt);
      }

      // Update cache directly instead of reloading all files
      if (!skipStoreUpdate) {
        upsertCachedSystemPrompt(prompt);
      }

      logInfo(`Created system prompt: ${prompt.title}`);
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  /**
   * Update an existing system prompt
   * @param oldTitle - The current title of the prompt
   * @param newPrompt - The updated prompt data
   * @param skipStoreUpdate - If true, skip updating the cache (useful for batch operations)
   */
  public async updatePrompt(
    oldTitle: string,
    newPrompt: UserSystemPrompt,
    skipStoreUpdate = false
  ): Promise<void> {
    const oldPath = getPromptFilePath(oldTitle);
    const newPath = getPromptFilePath(newPrompt.title);
    const isRename = oldTitle !== newPrompt.title;

    try {
      addPendingFileWrite(newPath);
      if (isRename) {
        addPendingFileWrite(oldPath);
      }

      // If title changed, rename the file
      if (isRename) {
        const oldFile = this.vault.getAbstractFileByPath(oldPath);
        if (oldFile instanceof TFile) {
          await app.fileManager.renameFile(oldFile, newPath);
        }
      }

      // Update content
      const file = this.vault.getAbstractFileByPath(newPath);
      if (file instanceof TFile) {
        await this.vault.modify(file, newPrompt.content);

        // Update frontmatter
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] = newPrompt.modifiedMs;
        });
      }

      // Update cache directly instead of reloading all files
      if (!skipStoreUpdate) {
        // If renamed, delete old cache entry first
        if (isRename) {
          deleteCachedSystemPrompt(oldTitle);

          // Update defaultSystemPromptTitle if it was pointing to the old title
          const settings = getSettings();
          if (settings.defaultSystemPromptTitle === oldTitle) {
            updateSetting("defaultSystemPromptTitle", newPrompt.title);
            logInfo(`Updated defaultSystemPromptTitle: ${oldTitle} -> ${newPrompt.title}`);
          }
        }
        upsertCachedSystemPrompt(newPrompt);
      }

      logInfo(`Updated system prompt: ${oldTitle} -> ${newPrompt.title}`);
    } finally {
      removePendingFileWrite(newPath);
      if (isRename) {
        removePendingFileWrite(oldPath);
      }
    }
  }

  /**
   * Delete a system prompt
   * @param title - The title of the prompt to delete
   */
  public async deletePrompt(title: string): Promise<void> {
    const filePath = getPromptFilePath(title);

    try {
      addPendingFileWrite(filePath);

      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.vault.delete(file);
      }

      // Update cache directly instead of reloading all files
      deleteCachedSystemPrompt(title);

      logInfo(`Deleted system prompt: ${title}`);
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  /**
   * Duplicate a system prompt
   */
  public async duplicatePrompt(prompt: UserSystemPrompt): Promise<UserSystemPrompt> {
    const existingPrompts = getCachedSystemPrompts();
    const newTitle = generateCopyPromptName(prompt.title, existingPrompts);
    const now = Date.now();

    const duplicatedPrompt: UserSystemPrompt = {
      title: newTitle,
      content: prompt.content,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    };

    await this.createPrompt(duplicatedPrompt);

    logInfo(`Duplicated system prompt: ${prompt.title} -> ${newTitle}`);

    return duplicatedPrompt;
  }

  /**
   * Get all prompts from cache
   */
  public getPrompts(): UserSystemPrompt[] {
    return getCachedSystemPrompts();
  }

  /**
   * Reload all prompts from file system
   */
  public async reloadPrompts(): Promise<UserSystemPrompt[]> {
    return await loadAllSystemPrompts();
  }
}
