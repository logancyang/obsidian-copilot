import { App } from "obsidian";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCustomCommandsFolder, validateCommandName } from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { getSettings, updateSetting } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import {
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
  DEFAULT_COMMANDS,
} from "@/commands/constants";
import { COPILOT_COMMAND_CONTEXT_MENU_ENABLED } from "@/commands/constants";
import { getCachedCustomCommands } from "@/commands/state";
import type { StartupMigrationItem } from "@/services/startupMigration";

async function saveUnsupportedCommands(app: App, commands: CustomCommand[]) {
  const folderPath = getCustomCommandsFolder();
  const unsupportedFolderPath = `${folderPath}/unsupported`;
  // Ensure nested structure exists regardless of platform
  await ensureFolderExists(app.vault, unsupportedFolderPath);
  return Promise.all(
    commands.map(async (command) => {
      const filePath = `${unsupportedFolderPath}/${command.title}.md`;
      const file = await app.vault.create(filePath, command.content);
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
        frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
        frontmatter[COPILOT_COMMAND_LAST_USED] = 0;
      });
    })
  );
}

/** Migrates the legacy commands in data.json to the new note format. */
export async function migrateCommands(app: App): Promise<StartupMigrationItem | null> {
  const legacyCommands = getSettings().inlineEditCommands;
  if (!legacyCommands || legacyCommands.length === 0) {
    return null;
  }
  const commandsToMigrate: CustomCommand[] = [];
  const unsupportedCommands: CustomCommand[] = [];
  const existingCommands = getCachedCustomCommands();

  const commands = legacyCommands.map((command, index) => ({
    title: command.name,
    content: command.prompt,
    showInContextMenu: command.showInContextMenu,
    showInSlashMenu: false,
    order: index * 10,
    modelKey: command.modelKey ?? "",
    lastUsedMs: 0,
  }));

  for (const command of commands) {
    const error = validateCommandName(command.title, existingCommands);
    if (error) {
      unsupportedCommands.push({
        ...command,
        title: encodeURIComponent(command.title),
        content: `> ${error} \n\nOriginal name: ${command.title} \n\n${command.content}`,
      });
    } else {
      commandsToMigrate.push(command);
    }
  }

  await CustomCommandManager.getInstance().updateCommands([
    ...existingCommands.map((command) => ({
      ...command,
      showInSlashMenu: true,
    })),
    ...commandsToMigrate,
  ]);

  const details = [`Stored in ${getCustomCommandsFolder()}.`];
  if (unsupportedCommands.length > 0) {
    await saveUnsupportedCommands(app, unsupportedCommands);
    details.push(
      `${unsupportedCommands.length} unsupported command${unsupportedCommands.length === 1 ? " was" : "s were"} saved in ${getCustomCommandsFolder()}/unsupported. Resolve the errors, then move each note out of that folder.`
    );
  }

  updateSetting("inlineEditCommands", []);

  return {
    id: "custom-commands",
    title: "Custom commands",
    status: unsupportedCommands.length > 0 ? "action-required" : "success",
    summary: `${commandsToMigrate.length} command${commandsToMigrate.length === 1 ? " was" : "s were"} migrated to note files.`,
    details,
  };
}

/** Generates the default commands. */
export async function generateDefaultCommands(): Promise<void> {
  const existingCommands = getCachedCustomCommands();
  const defaultCommands = DEFAULT_COMMANDS.filter(
    (command) => !existingCommands.some((c) => c.title === command.title)
  );
  const newCommands = [...existingCommands, ...defaultCommands];
  await CustomCommandManager.getInstance().updateCommands(newCommands);
}
