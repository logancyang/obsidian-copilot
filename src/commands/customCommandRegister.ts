import {
  getCommandId,
  isCustomCommandFile,
  loadAllCustomCommands,
  parseCustomCommandFile,
} from "@/commands/customCommandUtils";
import { Editor, Plugin, TFile, Vault } from "obsidian";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import debounce from "lodash.debounce";

/** This manager is used to register custom commands as obsidian commands */
export class CustomCommandRegister {
  private plugin: Plugin;
  private vault: Vault;
  private registeredCommandIds: Set<string> = new Set();

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
    for (const id of this.registeredCommandIds) {
      (this.plugin as any).removeCommand(id);
    }
    this.registeredCommandIds.clear();

    const files = this.vault.getFiles().filter((file) => isCustomCommandFile(file));
    await Promise.all(files.map((file) => this.registerCommandForFile(file)));
  }

  /**
   * Clean up resources used by the cache
   */
  cleanup() {
    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
    for (const id of this.registeredCommandIds) {
      (this.plugin as any).removeCommand(id);
    }
    this.registeredCommandIds.clear();
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
        await this.registerCommandForFile(file);
      }
    },
    5000,
    {
      leading: true,
      trailing: true,
    }
  );

  private handleFileCreation = async (file: TFile) => {
    if (isCustomCommandFile(file)) {
      await this.registerCommandForFile(file);
    }
  };

  private handleFileDeletion = (file: TFile) => {
    if (isCustomCommandFile(file)) {
      const commandId = getCommandId(file.basename);
      (this.plugin as any).removeCommand(commandId);
      this.registeredCommandIds.delete(commandId);
    }
  };

  private handleFileRename = (file: TFile, oldPath: string) => {
    // Remove the old command
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      const oldCommandId = getCommandId(oldFilename);
      (this.plugin as any).removeCommand(oldCommandId);
      this.registeredCommandIds.delete(oldCommandId);
    }
    // Register the new command if it's still a custom command file
    if (isCustomCommandFile(file)) {
      this.registerCommandForFile(file);
    }
  };

  private async registerCommandForFile(file: TFile) {
    const customCommand = await parseCustomCommandFile(file);
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
      },
    });
    this.registeredCommandIds.add(commandId);
  }
}
