import {
  getCommandId,
  isCustomCommandFile,
  loadAllCustomCommands,
  fetchAllCustomCommands,
  parseCustomCommandFile,
  getNextCustomCommandOrder,
  ensureCommandFrontmatter,
  hasOrderFrontmatter,
} from "@/commands/customCommandUtils";
import { App, Editor, Plugin, TFile, Vault } from "obsidian";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { debounce } from "@/utils/debounce";
import { CustomCommand } from "@/commands/type";
import {
  deleteCachedCommand,
  getCachedCustomCommands,
  isFileWritePending,
  updateCachedCommand,
  updateCachedCommands,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { deriveCustomPromptsFolder } from "@/settings/copilotFolder";
import { logError } from "@/logger";

export class CustomCommandRegister {
  private plugin: Plugin;
  private app: App;
  private vault: Vault;
  private settingsUnsubscriber?: () => void;
  private folderChangeRequestId = 0;
  private disposed = false;

  constructor(plugin: Plugin, app: App) {
    this.plugin = plugin;
    this.app = app;
    this.vault = app.vault;
    this.initializeEventListeners();
  }

  async initialize() {
    await loadAllCustomCommands(this.app);
    // Startup migrations outlive an unload that lands while commands load, and commands added
    // to an unloaded plugin are never removed. https://github.com/logancyang/obsidian-copilot/issues/3518
    if (this.disposed) return;
    this.registerCommands();
  }

  private registerCommands() {
    const commands = getCachedCustomCommands();
    commands.forEach((command) => {
      this.registerCommand(command);
    });
  }

  cleanup() {
    this.disposed = true;
    ++this.folderChangeRequestId;
    this.settingsUnsubscriber?.();
    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  private initializeEventListeners() {
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
    if (deriveCustomPromptsFolder(prev) !== deriveCustomPromptsFolder(next)) {
      void this.handleFolderChange();
    }
  };

  private async handleFolderChange(): Promise<void> {
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      const nextCommands = await fetchAllCustomCommands(this.app);

      if (this.disposed) return;

      if (currentRequestId !== this.folderChangeRequestId) return;

      const nextTitles = new Set(nextCommands.map((command) => command.title));
      for (const stale of getCachedCustomCommands()) {
        if (!nextTitles.has(stale.title)) {
          this.removeRegisteredCommand(stale.title);
        }
      }
      nextCommands.forEach((command) => this.registerCommand(command));
      updateCachedCommands(nextCommands);
    } catch (error) {
      if (currentRequestId !== this.folderChangeRequestId) return;
      logError("Error reloading custom commands after folder change", error);
    }
  }

  private removeRegisteredCommand(title: string): void {
    const commandId = getCommandId(title);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
  }

  private handleFileModify = debounce(
    async (file: TFile) => {
      if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
        return;
      }
      const customCommand = await parseCustomCommandFile(this.app, file);
      this.registerCommand(customCommand);
      updateCachedCommand(customCommand, customCommand.title);
    },
    1000,
    {
      leading: false,
      trailing: true,
    }
  );

  private handleFileCreation = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    try {
      let customCommand = await parseCustomCommandFile(this.app, file);
      if (!hasOrderFrontmatter(this.app, file)) {
        const newOrder = getNextCustomCommandOrder();
        customCommand = { ...customCommand, order: newOrder };
      }
      await ensureCommandFrontmatter(this.app, file, customCommand);
      updateCachedCommand(customCommand, customCommand.title);
      this.registerCommand(customCommand);
    } catch (error) {
      logError(`Error processing custom command creation: ${file.path}`, error);
    }
  };

  private handleFileDeletion = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    const commandId = getCommandId(file.basename);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
    deleteCachedCommand(file.basename);
  };

  private handleFileRename = async (file: TFile, oldPath: string) => {
    if (isFileWritePending(file.path)) {
      return;
    }
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      const oldCommandId = getCommandId(oldFilename);
      (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(
        oldCommandId
      );
      deleteCachedCommand(oldFilename);
    }
    if (isCustomCommandFile(file)) {
      const parsedCommand = await parseCustomCommandFile(this.app, file);
      this.registerCommand(parsedCommand);
      updateCachedCommand(parsedCommand, parsedCommand.title);
      await ensureCommandFrontmatter(this.app, file, parsedCommand);
    }
  };

  private registerCommand(customCommand: CustomCommand) {
    const commandId = getCommandId(customCommand.title);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
    this.plugin.addCommand({
      id: commandId,
      name: customCommand.title,
      editorCallback: (editor: Editor) => {
        new CustomCommandChatModal(this.plugin.app, {
          selectedText: editor.getSelection(),
          command: customCommand,
        }).open();
        void CustomCommandManager.getInstance()
          .recordUsage(customCommand)
          .catch((err) => logError("recordUsage failed", err));
      },
    });
  }
}
