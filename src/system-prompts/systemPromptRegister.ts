import { Plugin, TAbstractFile, Vault } from "obsidian";
import {
  isSystemPromptFile,
  getSystemPromptsFolder,
  parseSystemPromptFile,
  ensurePromptFrontmatter,
} from "@/system-prompts/systemPromptUtils";
import {
  isPendingFileWrite,
  initializeSessionPromptFromDefault,
  upsertCachedSystemPrompt,
  deleteCachedSystemPrompt,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import { getSettings, subscribeToSettingsChange, updateSetting } from "@/settings/model";
import { SystemPromptManager } from "@/system-prompts/systemPromptManager";
import { logInfo, logError } from "@/logger";
import debounce from "lodash.debounce";

/**
 * Manages vault event listeners for system prompts
 * Automatically syncs file changes to the cache
 */
export class SystemPromptRegister {
  private plugin: Plugin;
  private vault: Vault;
  private manager: SystemPromptManager;
  private settingsUnsubscriber?: () => void;

  constructor(plugin: Plugin, vault: Vault) {
    this.plugin = plugin;
    this.vault = vault;
    this.manager = SystemPromptManager.getInstance(vault);
    this.initializeEventListeners();
  }

  /**
   * Initialize the register by loading all prompts
   */
  async initialize(): Promise<void> {
    await this.manager.initialize();
    // Initialize session prompt from global default
    initializeSessionPromptFromDefault();
  }

  /**
   * Clean up event listeners when plugin unloads
   */
  cleanup(): void {
    // Cancel pending debounced operations
    this.handleFileModify.cancel();
    // Unsubscribe from settings changes
    this.settingsUnsubscriber?.();
    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  /**
   * Initialize vault event listeners
   */
  private initializeEventListeners(): void {
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  /**
   * Handle settings changes that affect system prompt caching
   */
  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    if (prev.userSystemPromptsFolder !== next.userSystemPromptsFolder) {
      void this.handleSystemPromptsFolderChange(
        prev.userSystemPromptsFolder,
        next.userSystemPromptsFolder
      );
    }
  };

  /**
   * Clear cached prompts and reload prompts from the new folder
   */
  private async handleSystemPromptsFolderChange(
    previousFolder: string,
    nextFolder: string
  ): Promise<void> {
    try {
      logInfo(`System prompts folder changed: ${previousFolder} -> ${nextFolder}`);
      // Clear all cached prompts
      updateCachedSystemPrompts([]);
      // Reload prompts from the new folder
      await this.manager.reloadPrompts();
    } catch (error) {
      logError(
        `Error reloading system prompts after folder change: ${previousFolder} -> ${nextFolder}`,
        error
      );
    }
  }

  /**
   * Handle file modification with debounce
   * Debounce ensures frontmatter is fully written before reloading
   */
  private handleFileModify = debounce(
    async (file: TAbstractFile) => {
      if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
        return;
      }
      try {
        logInfo(`System prompt file modified: ${file.path}`);
        const prompt = await parseSystemPromptFile(file);
        upsertCachedSystemPrompt(prompt);
      } catch (error) {
        logError(`Error processing system prompt modification: ${file.path}`, error);
      }
    },
    1000,
    {
      leading: false,
      trailing: true,
    }
  );

  /**
   * Handle file creation
   */
  private handleFileCreation = async (file: TAbstractFile) => {
    if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
      return;
    }
    try {
      logInfo(`System prompt file created: ${file.path}`);
      const prompt = await parseSystemPromptFile(file);
      // Ensure frontmatter is properly set
      await ensurePromptFrontmatter(file, prompt);
      // Re-parse to get updated timestamps after frontmatter is written
      const updatedPrompt = await parseSystemPromptFile(file);
      upsertCachedSystemPrompt(updatedPrompt);
    } catch (error) {
      logError(`Error processing system prompt creation: ${file.path}`, error);
    }
  };

  /**
   * Handle file deletion
   * Also clears defaultSystemPromptTitle if it points to the deleted file
   */
  private handleFileDeletion = async (file: TAbstractFile) => {
    if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
      return;
    }
    try {
      logInfo(`System prompt file deleted: ${file.path}`);
      deleteCachedSystemPrompt(file.basename);

      // Clear defaultSystemPromptTitle if it was pointing to the deleted file
      const settings = getSettings();
      if (settings.defaultSystemPromptTitle === file.basename) {
        updateSetting("defaultSystemPromptTitle", "");
        logInfo(`Cleared defaultSystemPromptTitle (deleted: ${file.basename})`);
      }
    } catch (error) {
      logError(`Error processing system prompt deletion: ${file.path}`, error);
    }
  };

  /**
   * Handle file rename
   * Reference: Similar to systemPromptManager.updatePrompt rename logic
   */
  private handleFileRename = async (file: TAbstractFile, oldPath: string) => {
    // Check pending status for both old and new paths
    if (isPendingFileWrite(file.path) || isPendingFileWrite(oldPath)) {
      return;
    }

    const folder = getSystemPromptsFolder();
    // Check if old path was a valid prompt file (direct child, not in subfolders like unsupported/)
    const oldRelativePath = oldPath.startsWith(folder + "/") ? oldPath.slice(folder.length + 1) : "";
    const wasValidPromptFile =
      oldRelativePath !== "" && !oldRelativePath.includes("/") && oldPath.endsWith(".md");
    // Use type guard to check if file is a valid system prompt file
    const promptFile = isSystemPromptFile(file) ? file : null;

    // Early return if neither old nor new location is relevant
    if (!wasValidPromptFile && !promptFile) {
      return;
    }

    try {
      logInfo(`System prompt file renamed: ${oldPath} -> ${file.path}`);

      // Remove the old prompt from cache if it was a valid prompt file
      if (wasValidPromptFile) {
        const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/i, "");
        if (oldFilename) {
          deleteCachedSystemPrompt(oldFilename);

          // Handle defaultSystemPromptTitle update
          const settings = getSettings();
          if (settings.defaultSystemPromptTitle === oldFilename) {
            if (promptFile) {
              // Rename within folder: update to new name
              updateSetting("defaultSystemPromptTitle", promptFile.basename);
              logInfo(`Updated defaultSystemPromptTitle: ${oldFilename} -> ${promptFile.basename}`);
            } else {
              // Move out of folder: clear the setting
              updateSetting("defaultSystemPromptTitle", "");
              logInfo(`Cleared defaultSystemPromptTitle (moved out: ${oldFilename})`);
            }
          }
        }
      }

      // Add the new prompt to cache if it's still in the folder
      if (promptFile) {
        const prompt = await parseSystemPromptFile(promptFile);
        await ensurePromptFrontmatter(promptFile, prompt);
        // Re-parse to get updated timestamps after frontmatter is written
        const updatedPrompt = await parseSystemPromptFile(promptFile);
        upsertCachedSystemPrompt(updatedPrompt);
      }
    } catch (error) {
      logError(`Error processing system prompt rename: ${file.path}`, error);
    }
  };
}
