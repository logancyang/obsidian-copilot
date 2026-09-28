import { App } from "obsidian";
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
import { ensureFolderExists } from "@/utils";
import {
  deleteFrontmatterMarkdownFile,
  renameFrontmatterMarkdownFile,
  writeFrontmatterMarkdownFile,
} from "@/utils/frontmatterMarkdownFile";

export class CustomCommandManager {
  private static instance: CustomCommandManager;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  static getInstance(app?: App): CustomCommandManager {
    if (!CustomCommandManager.instance) {
      if (!app) {
        throw new Error(
          "CustomCommandManager.getInstance() requires `app` on first call (seed it at plugin load)."
        );
      }
      CustomCommandManager.instance = new CustomCommandManager(app);
    }
    return CustomCommandManager.instance;
  }

  async createCommand(
    command: CustomCommand,
    options: { skipStoreUpdate?: boolean; autoOrder?: boolean } = {}
  ): Promise<void> {
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
      await ensureFolderExists(this.app.vault, folderPath);

      await writeFrontmatterMarkdownFile(this.app, filePath, command.content, {
        [COPILOT_COMMAND_CONTEXT_MENU_ENABLED]: command.showInContextMenu,
        [COPILOT_COMMAND_SLASH_ENABLED]: command.showInSlashMenu,
        [COPILOT_COMMAND_CONTEXT_MENU_ORDER]: command.order,
        [COPILOT_COMMAND_MODEL_KEY]: command.modelKey,
        [COPILOT_COMMAND_LAST_USED]: command.lastUsedMs,
      });

      if (!mergedOptions.skipStoreUpdate) {
        updateCachedCommand(command, command.title);
      }
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  async recordUsage(command: CustomCommand) {
    await this.updateCommand({ ...command, lastUsedMs: Date.now() }, command.title);
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
        updateCachedCommand(command, prevCommandTitle);
      }
      if (isRename) {
        if (await this.app.vault.adapter.exists(filePath)) {
          throw new CustomError(
            "Error saving custom prompt. Please check if the title already exists."
          );
        }
        if (await this.app.vault.adapter.exists(prevFilePath)) {
          await renameFrontmatterMarkdownFile(this.app, prevFilePath, filePath);
        }
      }

      if (!(await this.app.vault.adapter.exists(filePath))) {
        await this.createCommand(command, { skipStoreUpdate, autoOrder: true });
        return;
      }
      await writeFrontmatterMarkdownFile(this.app, filePath, command.content, {
        [COPILOT_COMMAND_CONTEXT_MENU_ENABLED]: command.showInContextMenu,
        [COPILOT_COMMAND_SLASH_ENABLED]: command.showInSlashMenu,
        [COPILOT_COMMAND_CONTEXT_MENU_ORDER]: command.order,
        [COPILOT_COMMAND_MODEL_KEY]: command.modelKey,
        [COPILOT_COMMAND_LAST_USED]: command.lastUsedMs,
      });
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
      await deleteFrontmatterMarkdownFile(this.app, filePath);
    } finally {
      removePendingFileWrite(filePath);
    }
  }
}
