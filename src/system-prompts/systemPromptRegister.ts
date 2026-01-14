import { Notice, Plugin, TAbstractFile, Vault } from "obsidian";
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
  getSelectedPromptTitle,
  setSelectedPromptTitle,
} from "@/system-prompts/state";
import { getSettings, subscribeToSettingsChange, updateSetting } from "@/settings/model";
import { SystemPromptManager } from "@/system-prompts/systemPromptManager";
import debounce from "lodash.debounce";
import { logError, logInfo } from "@/logger";

/**
 * Manages vault event listeners for system prompts
 * Automatically syncs file changes to the cache
 */
export class SystemPromptRegister {
  private plugin: Plugin;
  private vault: Vault;
  private manager: SystemPromptManager;
  private settingsUnsubscriber?: () => void;
  /** Monotonically increasing request ID for latest-wins semantics */
  private folderChangeRequestId = 0;

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
    this.debouncedFolderChange.cancel();
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
      this.debouncedFolderChange(next.userSystemPromptsFolder);
    }
  };

  /**
   * Debounced folder change handler to avoid rapid reloads during typing
   * Uses 300ms debounce + requestId for latest-wins semantics
   */
  private debouncedFolderChange = debounce(
    (nextFolder: string) => {
      void this.handleSystemPromptsFolderChange(nextFolder);
    },
    300,
    { leading: false, trailing: true }
  );

  /**
   * Reload prompts from the new folder using "success-then-replace" strategy
   * Uses requestId to implement true "latest-wins" semantics:
   * - Only the latest request's results are applied
   * - Earlier requests that complete later are discarded
   * - On failure, old cache is preserved (no empty state)
   */
  private async handleSystemPromptsFolderChange(nextFolder: string): Promise<void> {
    // Increment request ID - only the latest request will apply its results
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      logInfo(`System prompts folder changed to: ${nextFolder}`);

      // Fetch prompts without updating cache (to avoid race condition)
      const prompts = await this.manager.fetchPrompts();

      // Check if this is still the latest request
      if (currentRequestId !== this.folderChangeRequestId) {
        logInfo(`Folder change request ${currentRequestId} superseded by ${this.folderChangeRequestId}, discarding results`);
        return;
      }

      // Success: now replace the cache
      updateCachedSystemPrompts(prompts);

      // Validate selectedPromptTitle and defaultSystemPromptTitle
      const titles = new Set(prompts.map((p) => p.title));
      this.validatePromptReferences(titles);
    } catch (error) {
      // On failure, preserve old cache (no empty state)
      // Only log if this is still the latest request
      if (currentRequestId === this.folderChangeRequestId) {
        logError(`Error reloading system prompts after folder change to: ${nextFolder}`, error);
      }
    }
  }

  /**
   * Validate that selectedPromptTitle and defaultSystemPromptTitle still exist
   * Clears them with a Notice if they don't
   */
  private validatePromptReferences(availableTitles: Set<string>): void {
    const settings = getSettings();
    const selectedTitle = getSelectedPromptTitle();

    // Check defaultSystemPromptTitle
    if (settings.defaultSystemPromptTitle && !availableTitles.has(settings.defaultSystemPromptTitle)) {
      updateSetting("defaultSystemPromptTitle", "");
      logInfo(`Cleared defaultSystemPromptTitle (not found in new folder): ${settings.defaultSystemPromptTitle}`);
      new Notice(
        `Default system prompt "${settings.defaultSystemPromptTitle}" not found in new folder. Cleared default selection.`
      );
    }

    // Check selectedPromptTitle (session-level)
    if (selectedTitle && !availableTitles.has(selectedTitle)) {
      setSelectedPromptTitle("");
      logInfo(`Cleared selectedPromptTitle (not found in new folder): ${selectedTitle}`);
      new Notice(
        `Current system prompt "${selectedTitle}" not found in new folder. Cleared chat selection.`
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
   * Also clears defaultSystemPromptTitle and selectedPromptTitle if they point to the deleted file
   */
  private handleFileDeletion = async (file: TAbstractFile) => {
    if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
      return;
    }
    try {
      deleteCachedSystemPrompt(file.basename);

      // Clear defaultSystemPromptTitle if it was pointing to the deleted file
      const settings = getSettings();
      if (settings.defaultSystemPromptTitle === file.basename) {
        updateSetting("defaultSystemPromptTitle", "");
      }

      // Sync session-level selection to avoid silent fallback to empty prompt
      if (getSelectedPromptTitle() === file.basename) {
        setSelectedPromptTitle("");
        new Notice(`System prompt "${file.basename}" was deleted. Cleared current chat selection.`);
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
            } else {
              // Move out of folder: clear the setting
              updateSetting("defaultSystemPromptTitle", "");
            }
          }

          // Sync session-level selection to avoid silent fallback to empty prompt
          if (getSelectedPromptTitle() === oldFilename) {
            const nextTitle = promptFile ? promptFile.basename : "";
            setSelectedPromptTitle(nextTitle);
            if (promptFile) {
              new Notice(
                `System prompt "${oldFilename}" was renamed to "${promptFile.basename}". Updated current chat selection.`
              );
            } else {
              new Notice(
                `System prompt "${oldFilename}" was moved out of the prompts folder. Cleared current chat selection.`
              );
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
