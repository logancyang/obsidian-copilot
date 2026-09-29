import { App, Notice, Plugin, TAbstractFile, Vault } from "obsidian";
import {
  isSystemPromptFile,
  getSystemPromptsFolder,
  parseSystemPromptFile,
  ensurePromptFrontmatter,
  updatePromptDefaultFlag,
  fetchAllSystemPrompts,
  loadAllSystemPrompts,
} from "@/system-prompts/systemPromptUtils";
import {
  isPendingFileWrite,
  upsertCachedSystemPrompt,
  deleteCachedSystemPrompt,
  updateCachedSystemPrompts,
  getSelectedPromptTitle,
  setSelectedPromptTitle,
} from "@/system-prompts/state";
import { getSettings, subscribeToSettingsChange, updateSetting } from "@/settings/model";
import { deriveSystemPromptsFolder } from "@/settings/copilotFolder";
import { debounce } from "@/utils/debounce";
import { logError, logInfo } from "@/logger";

export class SystemPromptRegister {
  private plugin: Plugin;
  private app: App;
  private vault: Vault;
  private settingsUnsubscriber?: () => void;
  private folderChangeRequestId = 0;

  constructor(plugin: Plugin, app: App) {
    this.plugin = plugin;
    this.app = app;
    this.vault = app.vault;
    this.initializeEventListeners();
  }

  async initialize(): Promise<void> {
    await loadAllSystemPrompts(this.app);
    // Loading saved prompts must not turn a hidden legacy default into a session choice.
    // https://github.com/logancyang/obsidian-copilot/issues/3210
  }

  cleanup(): void {
    this.handleFileModify.cancel();
    this.debouncedFolderChange.cancel();
    this.settingsUnsubscriber?.();
    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  private initializeEventListeners(): void {
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    const prevFolder = deriveSystemPromptsFolder(prev);
    const nextFolder = deriveSystemPromptsFolder(next);
    const folderChanged = prevFolder !== nextFolder;
    const defaultChanged = prev.defaultSystemPromptTitle !== next.defaultSystemPromptTitle;

    if (defaultChanged) {
      const oldFolder = folderChanged ? prevFolder : undefined;
      void this.handleDefaultPromptChange(
        prev.defaultSystemPromptTitle,
        next.defaultSystemPromptTitle,
        oldFolder
      );
    }

    if (folderChanged) {
      this.debouncedFolderChange(nextFolder);
    }
  };

  private debouncedFolderChange = debounce(
    (nextFolder: string) => {
      void this.handleSystemPromptsFolderChange(nextFolder);
    },
    300,
    { leading: false, trailing: true }
  );

  private async handleDefaultPromptChange(
    oldTitle: string,
    newTitle: string,
    oldFolder?: string
  ): Promise<void> {
    try {
      if (oldTitle) {
        await updatePromptDefaultFlag(this.app, oldTitle, false, oldFolder);
      }
      if (newTitle) {
        await updatePromptDefaultFlag(this.app, newTitle, true);
      }
      logInfo(`Default system prompt changed: "${oldTitle}" -> "${newTitle}"`);
    } catch (error) {
      logError(`Error updating default system prompt frontmatter`, error);
    }
  }

  private async handleSystemPromptsFolderChange(nextFolder: string): Promise<void> {
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      logInfo(`System prompts folder changed to: ${nextFolder}`);

      const prompts = await fetchAllSystemPrompts(this.app);

      if (currentRequestId !== this.folderChangeRequestId) {
        logInfo(
          `Folder change request ${currentRequestId} superseded by ${this.folderChangeRequestId}, discarding results`
        );
        return;
      }

      updateCachedSystemPrompts(prompts);

      const titles = new Set(prompts.map((p) => p.title));
      this.validatePromptReferences(titles);
    } catch (error) {
      if (currentRequestId === this.folderChangeRequestId) {
        logError(`Error reloading system prompts after folder change to: ${nextFolder}`, error);
      }
    }
  }

  private validatePromptReferences(availableTitles: Set<string>): void {
    const settings = getSettings();
    const selectedTitle = getSelectedPromptTitle();

    if (
      settings.defaultSystemPromptTitle &&
      !availableTitles.has(settings.defaultSystemPromptTitle)
    ) {
      updateSetting("defaultSystemPromptTitle", "");
      logInfo(
        `Cleared defaultSystemPromptTitle (not found in new folder): ${settings.defaultSystemPromptTitle}`
      );
      new Notice(
        `Default system prompt "${settings.defaultSystemPromptTitle}" not found in new folder. Cleared default selection.`
      );
    }

    if (selectedTitle && !availableTitles.has(selectedTitle)) {
      setSelectedPromptTitle("");
      logInfo(`Cleared selectedPromptTitle (not found in new folder): ${selectedTitle}`);
      new Notice(
        `Current system prompt "${selectedTitle}" not found in new folder. Cleared chat selection.`
      );
    }
  }

  private handleFileModify = debounce(
    async (file: TAbstractFile) => {
      if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
        return;
      }
      try {
        const prompt = await parseSystemPromptFile(this.app, file);
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

  private handleFileCreation = async (file: TAbstractFile) => {
    if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
      return;
    }
    try {
      const prompt = await parseSystemPromptFile(this.app, file);
      await ensurePromptFrontmatter(this.app, file, prompt);
      const updatedPrompt = await parseSystemPromptFile(this.app, file);
      upsertCachedSystemPrompt(updatedPrompt);
    } catch (error) {
      logError(`Error processing system prompt creation: ${file.path}`, error);
    }
  };

  private handleFileDeletion = async (file: TAbstractFile) => {
    if (!isSystemPromptFile(file) || isPendingFileWrite(file.path)) {
      return;
    }
    try {
      deleteCachedSystemPrompt(file.basename);

      const settings = getSettings();
      if (settings.defaultSystemPromptTitle === file.basename) {
        updateSetting("defaultSystemPromptTitle", "");
      }

      if (getSelectedPromptTitle() === file.basename) {
        setSelectedPromptTitle("");
        new Notice(`System prompt "${file.basename}" was deleted. Cleared current chat selection.`);
      }
    } catch (error) {
      logError(`Error processing system prompt deletion: ${file.path}`, error);
    }
  };

  private handleFileRename = async (file: TAbstractFile, oldPath: string) => {
    if (isPendingFileWrite(file.path) || isPendingFileWrite(oldPath)) {
      return;
    }

    const folder = getSystemPromptsFolder();
    const oldRelativePath = oldPath.startsWith(folder + "/")
      ? oldPath.slice(folder.length + 1)
      : "";
    const wasValidPromptFile =
      oldRelativePath !== "" && !oldRelativePath.includes("/") && oldPath.endsWith(".md");
    const promptFile = isSystemPromptFile(file) ? file : null;

    if (!wasValidPromptFile && !promptFile) {
      return;
    }

    try {
      if (wasValidPromptFile) {
        const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/i, "");
        if (oldFilename) {
          deleteCachedSystemPrompt(oldFilename);

          const settings = getSettings();
          if (settings.defaultSystemPromptTitle === oldFilename) {
            if (promptFile) {
              updateSetting("defaultSystemPromptTitle", promptFile.basename);
            } else {
              updateSetting("defaultSystemPromptTitle", "");
            }
          }

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

      if (promptFile) {
        const prompt = await parseSystemPromptFile(this.app, promptFile);
        await ensurePromptFrontmatter(this.app, promptFile, prompt);
        const updatedPrompt = await parseSystemPromptFile(this.app, promptFile);
        upsertCachedSystemPrompt(updatedPrompt);
      }
    } catch (error) {
      logError(`Error processing system prompt rename: ${file.path}`, error);
    }
  };
}
