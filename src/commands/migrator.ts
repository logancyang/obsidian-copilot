import { CustomCommandManager } from "@/commands/customCommandManager";
import {
  getCustomCommandsFolder,
  loadAllCustomCommands,
  validateCommandName,
} from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { getSettings, updateSetting } from "@/settings/model";
import {
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
} from "@/commands/constants";
import { COPILOT_COMMAND_CONTEXT_MENU_ENABLED } from "@/commands/constants";
import { ConfirmModal } from "@/components/modals/ConfirmModal";

function saveUnsupportedCommands(commands: CustomCommand[]) {
  const folderPath = getCustomCommandsFolder();
  const unsupportedFolderPath = `${folderPath}/unsupported`;
  const unsupportedFolder = app.vault.getAbstractFileByPath(unsupportedFolderPath);
  if (!unsupportedFolder) {
    app.vault.createFolder(unsupportedFolderPath);
  }
  return Promise.all(
    commands.map(async (command) => {
      const filePath = `${unsupportedFolderPath}/${command.title}.md`;
      const file = await app.vault.create(filePath, command.content);
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
        frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
        frontmatter[COPILOT_COMMAND_LAST_USED] = 0;
      });
    })
  );
}

export async function migrateCommands() {
  const legacyCommands = getSettings().inlineEditCommands;
  if (!legacyCommands || legacyCommands.length === 0) {
    return;
  }
  const commandsToMigrate: CustomCommand[] = [];
  const unsupportedCommands: CustomCommand[] = [];
  const existingCommands = await loadAllCustomCommands();

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
    ...existingCommands,
    ...commandsToMigrate,
  ]);

  let message = `We have upgraded your commands to the new format. They are now stored as notes in ${getCustomCommandsFolder()}.`;
  if (unsupportedCommands.length > 0) {
    await saveUnsupportedCommands(unsupportedCommands);
    message += `\n\nWe have also saved ${unsupportedCommands.length} unsupported commands in ${getCustomCommandsFolder()}/unsupported.`;
  }

  updateSetting("inlineEditCommands", []);

  new ConfirmModal(app, () => {}, message, "Commands migrated successfully", "OK", "").open();
}
