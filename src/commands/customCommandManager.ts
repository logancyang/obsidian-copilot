import { TFile } from "obsidian";
import {
  getCommandFilePath,
  getCustomCommandsFolder,
  getNextCustomCommandOrder,
} from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { CustomError } from "@/error";
import {
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
} from "@/commands/constants";
import {
  addPendingFileWrite,
  deleteCachedCommand,
  removePendingFileWrite,
  updateCachedCommand,
  updateCachedCommands,
} from "./state";

export class CustomCommandManager {
  private static instance: CustomCommandManager;

  static getInstance(): CustomCommandManager {
    if (!CustomCommandManager.instance) {
      CustomCommandManager.instance = new CustomCommandManager();
    }
    return CustomCommandManager.instance;
  }

  /**
   * Creates a new command file and caches the command in memory.
   * If autoOrder is true, the order of the command is set to the next available order.
   * If autoOrder is false (default), preserves the order from the command object/frontmatter.
   */
  async createCommand(
    command: CustomCommand,
    options: { skipStoreUpdate?: boolean; autoOrder?: boolean } = {}
  ): Promise<void> {
    // Merge default options with provided options
    const mergedOptions = { skipStoreUpdate: false, autoOrder: true, ...options };
    const filePath = getCommandFilePath(command.title);
    try {
      addPendingFileWrite(filePath);
      let newOrder = command.order;
      if (mergedOptions.autoOrder) {
        newOrder = getNextCustomCommandOrder();
      }
      command = { ...command, order: newOrder };

      const folderPath = getCustomCommandsFolder();
      // Check if the folder exists and create it if it doesn't
      const folderExists = await app.vault.adapter.exists(folderPath);
      if (!folderExists) {
        await app.vault.createFolder(folderPath);
      }

      let commandFile = app.vault.getAbstractFileByPath(filePath) as TFile;
      if (!commandFile || !(commandFile instanceof TFile)) {
        commandFile = await app.vault.create(filePath, command.content);
      } else {
        await app.vault.modify(commandFile, command.content);
      }

      await app.fileManager.processFrontMatter(commandFile, (frontmatter) => {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
        frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
        frontmatter[COPILOT_COMMAND_LAST_USED] = command.lastUsedMs;
      });

      if (!mergedOptions.skipStoreUpdate) {
        updateCachedCommand(command, command.title);
      }
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  async recordUsage(command: CustomCommand) {
    this.updateCommand({ ...command, lastUsedMs: Date.now() }, command.title);
  }

  async updateCommand(command: CustomCommand, prevCommandTitle: string, skipStoreUpdate = false) {
    const filePath = getCommandFilePath(command.title);
    const prevFilePath = getCommandFilePath(prevCommandTitle);
    const isRename = command.title !== prevCommandTitle;
    try {
      addPendingFileWrite(filePath);
      if (isRename) {
        addPendingFileWrite(prevFilePath);
      }
      if (!skipStoreUpdate) {
        // Update the cached command first to make UI update immediately.
        updateCachedCommand(command, prevCommandTitle);
      }
      let commandFile = app.vault.getAbstractFileByPath(filePath);
      // Verify whether the title has changed to decide whether to rename the file
      if (isRename) {
        const newFileExists = app.vault.getAbstractFileByPath(filePath);
        if (newFileExists) {
          throw new CustomError(
            "Error saving custom prompt. Please check if the title already exists."
          );
        }
        const prevCommandFile = app.vault.getAbstractFileByPath(prevFilePath);
        if (prevCommandFile instanceof TFile) {
          await app.vault.rename(prevCommandFile, filePath);
          // Re-fetch the file object after renaming
          commandFile = app.vault.getAbstractFileByPath(filePath);
        }
      }

      if (!commandFile) {
        // Pass skipStoreUpdate to createCommand to avoid redundant cache update
        // When creating a new command, we want to auto-order it so it appears
        // at the bottom of the menu.
        await this.createCommand(command, { skipStoreUpdate, autoOrder: true });
        commandFile = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
      }

      if (commandFile instanceof TFile) {
        await app.vault.modify(commandFile, command.content);
        await app.fileManager.processFrontMatter(commandFile, (frontmatter) => {
          frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
          frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
          frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
          frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
          frontmatter[COPILOT_COMMAND_LAST_USED] = command.lastUsedMs;
        });
      }
    } finally {
      removePendingFileWrite(filePath);
      if (isRename) {
        removePendingFileWrite(prevFilePath);
      }
    }
  }

  async updateCommands(commands: CustomCommand[]) {
    updateCachedCommands(commands);
    await Promise.all(commands.map((command) => this.updateCommand(command, command.title, true)));
  }

  /**
   * Reorders the given commands by setting their order property in increments of 10,
   * then updates all commands in the manager.
   */
  async reorderCommands(commands: CustomCommand[]) {
    const newCommands = [...commands];
    for (let i = 0; i < newCommands.length; i++) {
      newCommands[i] = { ...newCommands[i], order: i * 10 };
    }
    await this.updateCommands(newCommands);
  }

  async deleteCommand(command: CustomCommand) {
    const filePath = getCommandFilePath(command.title);
    try {
      addPendingFileWrite(filePath);
      deleteCachedCommand(command.title);
      const file = app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await app.vault.delete(file);
      }
    } finally {
      removePendingFileWrite(filePath);
    }
  }
}
