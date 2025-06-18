import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCustomCommandsFolder, validateCommandName } from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { getSettings, updateSetting } from "@/settings/model";
import {
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
  DEFAULT_COMMANDS,
} from "@/commands/constants";
import { COPILOT_COMMAND_CONTEXT_MENU_ENABLED } from "@/commands/constants";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { getCachedCustomCommands } from "@/commands/state";

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

/** Migrates the legacy commands in data.json to the new note format. */
export async function migrateCommands() {
  const legacyCommands = getSettings().inlineEditCommands;
  if (!legacyCommands || legacyCommands.length === 0) {
    return;
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

  let message = `We have upgraded your commands to the new format. They are now also stored as notes in ${getCustomCommandsFolder()}.`;
  if (unsupportedCommands.length > 0) {
    await saveUnsupportedCommands(unsupportedCommands);
    message += `\n\nWe found ${unsupportedCommands.length} unsupported commands. They are saved in ${getCustomCommandsFolder()}/unsupported. To fix them, please resolve the errors and move the note file out of the unsupported folder.`;
  }

  updateSetting("inlineEditCommands", []);

  new ConfirmModal(app, () => {}, message, "🚀 New Copilot Custom Commands", "OK", "").open();
}

/** Generates the default commands. */
export async function generateDefaultCommands(): Promise<void> {
  const existingCommands = getCachedCustomCommands();
  const defaultCommands = DEFAULT_COMMANDS.filter(
    (command) => !existingCommands.some((c) => c.title === command.title)
  );
  const newCommands = [...existingCommands, ...defaultCommands];
  CustomCommandManager.getInstance().updateCommands(newCommands);
}

/** Suggests the default commands if the user has not created any commands yet. */
export async function suggestDefaultCommands(): Promise<void> {
  const suggestedCommand = getSettings().suggestedDefaultCommands;
  if (suggestedCommand) {
    // We only show the modal once
    return;
  }
  const existingCommands = getCachedCustomCommands();
  if (existingCommands.length === 0) {
    new ConfirmModal(
      app,
      () => {
        generateDefaultCommands();
      },
      "Would you like to add Copilot recommended commands in your custom prompts folder? These commands will be available through the right-click context menu and slash commands in chat.",
      "Welcome to Copilot",
      "Confirm",
      "Skip"
    ).open();
    updateSetting("suggestedDefaultCommands", true);
  }
}
