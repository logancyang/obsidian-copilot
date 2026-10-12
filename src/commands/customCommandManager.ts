import { App } from "obsidian";
import {
  commandFrontmatter,
  getCommandFilePath,
  getCustomCommandsFolder,
  getNextCustomCommandOrder,
} from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { CustomError } from "@/error";
import {
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
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
  renamePath,
  trashPath,
  updateFrontmatter,
  writeFrontmatterFile,
} from "@/utils/vaultAdapterUtils";

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

      await writeFrontmatterFile(this.app, filePath, commandFrontmatter(command), command.content);

      if (!mergedOptions.skipStoreUpdate) {
        updateCachedCommand(command, command.title);
      }
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  async recordUsage(command: CustomCommand) {
    const lastUsedMs = Date.now();
    await this.updateCommandFrontmatter(command.title, (frontmatter) => {
      frontmatter[COPILOT_COMMAND_LAST_USED] = lastUsedMs;
    });
    updateCachedCommand({ ...command, lastUsedMs }, command.title);
  }

  private async updateCommandFrontmatter(
    title: string,
    update: (frontmatter: Record<string, unknown>) => void
  ): Promise<void> {
    const filePath = getCommandFilePath(title);
    try {
      addPendingFileWrite(filePath);
      await updateFrontmatter(this.app, filePath, update);
    } finally {
      removePendingFileWrite(filePath);
    }
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
      if (isRename) {
        if (await this.app.vault.adapter.exists(filePath)) {
          throw new CustomError(
            "Error saving custom prompt. Please check if the title already exists."
          );
        }
        if (await this.app.vault.adapter.exists(prevFilePath)) {
          await renamePath(this.app, prevFilePath, filePath);
        }
      }

      if (!(await this.app.vault.adapter.exists(filePath))) {
        await this.createCommand(command, { skipStoreUpdate, autoOrder: true });
        // A hidden file can be deleted externally while its old title stays cached. https://github.com/logancyang/obsidian-copilot/issues/3075
        if (isRename && !skipStoreUpdate) deleteCachedCommand(prevCommandTitle);
        return;
      }
      await writeFrontmatterFile(this.app, filePath, commandFrontmatter(command), command.content);
      // Failed saves must not replace the command that the palette runs. https://github.com/logancyang/obsidian-copilot/issues/3075
      if (!skipStoreUpdate) updateCachedCommand(command, prevCommandTitle);
    } finally {
      removePendingFileWrite(filePath);
      if (isRename) {
        removePendingFileWrite(prevFilePath);
      }
    }
  }

  async updateCommands(commands: CustomCommand[]) {
    await Promise.all(commands.map((command) => this.updateCommand(command, command.title, true)));
    updateCachedCommands(commands);
  }

  async reorderCommands(commands: CustomCommand[]) {
    const ordered = commands.map((command, index) => ({ ...command, order: index * 10 }));
    await Promise.all(
      ordered.map((command) =>
        this.updateCommandFrontmatter(command.title, (frontmatter) => {
          frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        })
      )
    );
    updateCachedCommands(ordered);
  }

  async deleteCommand(command: CustomCommand) {
    const filePath = getCommandFilePath(command.title);
    try {
      addPendingFileWrite(filePath);
      await trashPath(this.app, filePath);
      deleteCachedCommand(command.title);
    } finally {
      removePendingFileWrite(filePath);
    }
  }
}
