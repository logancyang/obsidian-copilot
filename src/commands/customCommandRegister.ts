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
  updateCachedCommand,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { logInfo } from "@/logger";

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
    1000,
    {
      // We cannot use leading: true because frontmatter is not updated
      // immediately when modify event is triggered.
      leading: false,
      trailing: true,
    }
  );

  /**
   * Waits for the custom command file to have its frontmatter processed.
   * Retries parsing the file until required frontmatter fields are present or max retries reached.
   */
  private async waitForFrontmatter(
    file: TFile,
    maxRetries = 10,
    delayMs = 200
  ): Promise<CustomCommand | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check if file still exists and is a custom command file
      const currentFile = this.vault.getAbstractFileByPath(file.path);
      if (!currentFile || !(currentFile instanceof TFile) || !isCustomCommandFile(currentFile)) {
        return null; // File was deleted or is no longer a custom command file
      }
      try {
        const customCommand = await parseCustomCommandFile(currentFile);
        // Check for required frontmatter fields (e.g., showInContextMenu, showInSlashMenu, order, modelKey, lastUsedMs)
        if (
          typeof customCommand.showInContextMenu === "boolean" &&
          typeof customCommand.showInSlashMenu === "boolean" &&
          typeof customCommand.order === "number" &&
          typeof customCommand.modelKey === "string" &&
          typeof customCommand.lastUsedMs === "number"
        ) {
          return customCommand;
        }
      } catch {
        // Ignore parse errors, will retry
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  private handleFileCreation = async (file: TFile) => {
    if (isCustomCommandFile(file)) {
      try {
        logInfo("new command file created", file.path);
        const customCommand = await this.waitForFrontmatter(file);
        if (!customCommand) {
          console.error(
            `[CustomCommandRegister] Failed to process custom command file (frontmatter not ready): ${file.path}`
          );
          return;
        }
        const cachedCommands = getCachedCustomCommands();
        const latestCommand = cachedCommands.find((cmd) => cmd.title === customCommand.title);
        // The cache may have been updated since the file was created, so we need to
        // check if the command exists in the cache. Only update the command if it doesn't
        // exist in the cache.
        if (!latestCommand) {
          // Call updateCommand to ensure the command frontmatter is set correctly
          await CustomCommandManager.getInstance().updateCommand(
            customCommand,
            customCommand.title
          );
        }
        this.registerCommand(customCommand);
      } catch (error) {
        console.error(
          `[CustomCommandRegister] Error processing custom command file: ${file.path}`,
          error
        );
      }
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
      logInfo("command file renamed", file.path);
      const parsedCommand = await parseCustomCommandFile(file);
      const cachedCommands = getCachedCustomCommands();
      const latestCommand = cachedCommands.find((cmd) => cmd.title === parsedCommand.title);
      if (latestCommand) {
        // Use the latest command object to ensure latest edits are persisted
        await CustomCommandManager.getInstance().updateCommand(latestCommand, latestCommand.title);
      } else {
        // Fallback: use the parsed file if no cached command exists
        await CustomCommandManager.getInstance().updateCommand(parsedCommand, parsedCommand.title);
      }
      this.registerCommand(parsedCommand);
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
