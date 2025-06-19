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
  createCachedCommand,
  deleteCachedCommand,
  getCachedCustomCommands,
  updateCachedCommand,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";

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
      if (isCustomCommandFile(file)) {
        const customCommand = await parseCustomCommandFile(file);
        this.registerCommand(customCommand);
        updateCachedCommand(customCommand, customCommand.title);
      }
    },
    3000,
    {
      // We cannot use leading: true because frontmatter is not updated
      // immediately when modify event is triggered.
      leading: false,
      trailing: true,
    }
  );

  private handleFileCreation = async (file: TFile) => {
    if (isCustomCommandFile(file)) {
      const customCommand = await parseCustomCommandFile(file);
      this.registerCommand(customCommand);
      createCachedCommand(customCommand.title);
    }
  };

  private handleFileDeletion = async (file: TFile) => {
    if (isCustomCommandFile(file)) {
      const commandId = getCommandId(file.basename);
      (this.plugin as any).removeCommand(commandId);
      deleteCachedCommand(file.basename);
    }
  };

  private handleFileRename = async (file: TFile, oldPath: string) => {
    // Remove the old command
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      const oldCommandId = getCommandId(oldFilename);
      (this.plugin as any).removeCommand(oldCommandId);
      deleteCachedCommand(oldFilename);
    }
    // Register the new command if it's still a custom command file
    if (isCustomCommandFile(file)) {
      const customCommand = await parseCustomCommandFile(file);
      this.registerCommand(customCommand);
      updateCachedCommand(customCommand, customCommand.title);
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
