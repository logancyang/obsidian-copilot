import { TFile } from "obsidian";
import { getCommandFilePath, getCustomCommandsFolder } from "@/commands/customCommandUtils";
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
  createCachedCommand,
  deleteCachedCommand,
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

  async createCommand(title: string, content: string, skipStoreUpdate = false): Promise<void> {
    if (!skipStoreUpdate) {
      createCachedCommand(title);
    }
    const folderPath = getCustomCommandsFolder();
    const filePath = getCommandFilePath(title);

    // Check if the folder exists and create it if it doesn't
    const folderExists = await app.vault.adapter.exists(folderPath);
    if (!folderExists) {
      await app.vault.createFolder(folderPath);
    }

    const file = await app.vault.create(filePath, content);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = false;
      frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = false;
      frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = Number.MAX_SAFE_INTEGER;
      frontmatter[COPILOT_COMMAND_MODEL_KEY] = "";
      frontmatter[COPILOT_COMMAND_LAST_USED] = 0;
    });
  }

  async recordUsage(command: CustomCommand) {
    this.updateCommand({ ...command, lastUsedMs: Date.now() }, command.title);
  }

  async updateCommand(command: CustomCommand, prevCommandTitle: string, skipStoreUpdate = false) {
    if (!skipStoreUpdate) {
      updateCachedCommand(command, prevCommandTitle);
    }

    let commandFile = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
    // Verify whether the title has changed to decide whether to rename the file
    if (command.title !== prevCommandTitle) {
      const newFilePath = getCommandFilePath(command.title);
      const newFileExists = app.vault.getAbstractFileByPath(newFilePath);
      if (newFileExists) {
        throw new CustomError(
          "Error saving custom prompt. Please check if the title already exists."
        );
      }
      const prevFilePath = getCommandFilePath(prevCommandTitle);
      const prevCommandFile = app.vault.getAbstractFileByPath(prevFilePath);
      if (prevCommandFile instanceof TFile) {
        await app.vault.rename(prevCommandFile, newFilePath);
        commandFile = prevCommandFile;
      }
    }

    if (!commandFile) {
      await this.createCommand(command.title, command.content, skipStoreUpdate);
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
  }

  async updateCommands(commands: CustomCommand[]) {
    updateCachedCommands(commands);
    await Promise.all(commands.map((command) => this.updateCommand(command, command.title, true)));
  }

  async deleteCommand(command: CustomCommand) {
    deleteCachedCommand(command.title);
    const file = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
    if (file instanceof TFile) {
      await app.vault.delete(file);
    }
  }
}
