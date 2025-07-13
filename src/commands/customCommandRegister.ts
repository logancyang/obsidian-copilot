import {
  getCommandId,
  isCustomCommandFile,
  loadAllCustomCommands,
  parseCustomCommandFile,
} from "@/commands/customCommandUtils";
import { Editor, Plugin, TFile, Vault } from "obsidian";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import debounce from "lodash.debounce";
import { CustomCommand } from "@/commands/type";
import {
  deleteCachedCommand,
  getCachedCustomCommands,
  isFileWritePending,
  updateCachedCommand,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { logError, logInfo } from "@/logger";

/** This manager is used to register custom commands as obsidian commands */
export class CustomCommandRegister {
  private plugin: Plugin;
  private vault: Vault;

  constructor(plugin: Plugin, vault: Vault) {
    this.plugin = plugin;
    this.vault = vault;
    this.initializeEventListeners();
  }

  async initialize() {
    await loadAllCustomCommands();
    this.registerCommands();
  }

  /**
   * Register all custom commands found in the custom commands folder.
   */
  private async registerCommands() {
    const commands = getCachedCustomCommands();
    commands.forEach((command) => {
      this.registerCommand(command);
    });
  }

  /**
   * Clean up resources used by the cache
   */
  cleanup() {
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
  }

  private handleFileModify = debounce(
    async (file: TFile) => {
      if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
        return;
      }
      const customCommand = await parseCustomCommandFile(file);
      logInfo("command file modified", file.path, customCommand);
      this.registerCommand(customCommand);
      updateCachedCommand(customCommand, customCommand.title);
    },
    1000,
    {
      // We cannot use leading: true because frontmatter is not updated
      // immediately when modify event is triggered.
      leading: false,
      trailing: true,
    }
  );

  private handleFileCreation = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    try {
      logInfo("new command file created", file.path);
      const customCommand = await parseCustomCommandFile(file);
      await CustomCommandManager.getInstance().createCommand(customCommand);
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
    (this.plugin as any).removeCommand(commandId);
    deleteCachedCommand(file.basename);
  };

  private handleFileRename = async (file: TFile, oldPath: string) => {
    if (isFileWritePending(file.path)) {
      return;
    }
    // Remove the old command
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      const oldCommandId = getCommandId(oldFilename);
      (this.plugin as any).removeCommand(oldCommandId);
      deleteCachedCommand(oldFilename);
    }
    // Register the new command if it's still a custom command file
    if (isCustomCommandFile(file)) {
      logInfo("command file renamed", file.path);
      const parsedCommand = await parseCustomCommandFile(file);
      this.registerCommand(parsedCommand);
      updateCachedCommand(parsedCommand, parsedCommand.title);
    }
  };

  private registerCommand(customCommand: CustomCommand) {
    const commandId = getCommandId(customCommand.title);
    (this.plugin as any).removeCommand(commandId);
    this.plugin.addCommand({
      id: commandId,
      name: customCommand.title,
      editorCallback: (editor: Editor) => {
        new CustomCommandChatModal(this.plugin.app, {
          selectedText: editor.getSelection(),
          command: customCommand,
        }).open();
        CustomCommandManager.getInstance().recordUsage(customCommand);
      },
    });
  }
}
