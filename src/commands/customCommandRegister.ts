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
  subscribeToCustomCommandsChange,
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
  private commandsUnsubscriber?: () => void;
  private registeredTitles = new Set<string>();
  private folderChangeRequestId = 0;

  constructor(plugin: Plugin, app: App) {
    this.plugin = plugin;
    this.app = app;
    this.vault = app.vault;
    this.initializeEventListeners();
  }

  async initialize() {
    await loadAllCustomCommands(this.app);
  }

  cleanup() {
    ++this.folderChangeRequestId;
    this.settingsUnsubscriber?.();
    // After this no change to the command store can reach the palette, so commands loaded for an
    // unloaded plugin are never added. https://github.com/logancyang/obsidian-copilot/issues/3518
    this.commandsUnsubscriber?.();
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
    this.commandsUnsubscriber = subscribeToCustomCommandsChange(this.syncPalette);
  }

  private syncPalette = (): void => {
    const commands = getCachedCustomCommands();
    const titles = new Set(commands.map((command) => command.title));
    for (const title of this.registeredTitles) {
      if (!titles.has(title)) this.removeRegisteredCommand(title);
    }
    commands.forEach((command) => this.registerCommand(command));
    this.registeredTitles = titles;
  };

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

      if (currentRequestId !== this.folderChangeRequestId) return;

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
      if (!(await hasOrderFrontmatter(this.app, file))) {
        const newOrder = getNextCustomCommandOrder();
        customCommand = { ...customCommand, order: newOrder };
      }
      await ensureCommandFrontmatter(this.app, file, customCommand);
      updateCachedCommand(customCommand, customCommand.title);
    } catch (error) {
      logError(`Error processing custom command creation: ${file.path}`, error);
    }
  };

  private handleFileDeletion = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    deleteCachedCommand(file.basename);
  };

  private handleFileRename = async (file: TFile, oldPath: string) => {
    if (isFileWritePending(file.path)) {
      return;
    }
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      deleteCachedCommand(oldFilename);
    }
    if (isCustomCommandFile(file)) {
      const parsedCommand = await parseCustomCommandFile(this.app, file);
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
