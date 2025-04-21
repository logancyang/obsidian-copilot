import {
  COMMAND_NAME_MAX_LENGTH,
  DEFAULT_INLINE_EDIT_COMMANDS,
  SELECTED_TEXT_PLACEHOLDER as LEGACY_SELECTED_TEXT_PLACEHOLDER,
} from "@/commands/constants";
import { processPrompt } from "@/customPromptProcessor";
import { InlineEditCommandSettings, getSettings, useSettingsValue } from "@/settings/model";

export function getCommandId(commandName: string) {
  return encodeURIComponent(commandName.toLowerCase());
}

/**
 * Validate the command name. A command name must be:
 * - less than 50 characters
 * - not empty
 * - not duplicate an existing command name (except when editing the same command)
 * @param commandName - The name of the command.
 * @param currentCommandName - Optional. The current name of the command being edited.
 */
export function validateCommandName(commandName: string, currentCommandName?: string) {
  if (!commandName) {
    throw new Error("Command name is required");
  }

  if (commandName.length > COMMAND_NAME_MAX_LENGTH) {
    throw new Error(`Command name must be less than ${COMMAND_NAME_MAX_LENGTH} characters`);
  }

  // Check for duplicate command names, but allow keeping the same name when editing
  const existingCommands = getInlineEditCommands();
  if (
    existingCommands.some(
      (cmd) =>
        cmd.name.toLowerCase() === commandName.toLowerCase() &&
        cmd.name.toLowerCase() !== currentCommandName?.toLowerCase()
    )
  ) {
    throw new Error("A command with this name already exists");
  }
}

export function getCommandById(commandId: string): InlineEditCommandSettings | undefined {
  const commandSettings = getInlineEditCommands();
  return commandSettings.find((command) => getCommandId(command.name) === commandId);
}

export function getInlineEditCommands(): InlineEditCommandSettings[] {
  return getSettings().inlineEditCommands ?? DEFAULT_INLINE_EDIT_COMMANDS;
}

export function useInlineEditCommands(): InlineEditCommandSettings[] {
  const settings = useSettingsValue();
  return settings.inlineEditCommands ?? DEFAULT_INLINE_EDIT_COMMANDS;
}

/**
 * Process the command prompt.
 */
export async function processCommandPrompt(
  prompt: string,
  selectedText: string,
  skipAppendingSelectedText = false
) {
  const result = await processPrompt(
    prompt,
    selectedText,
    app.vault,
    app.workspace.getActiveFile()
  );

  const processedPrompt = result.processedPrompt;

  if (processedPrompt.includes("{selectedText}") || skipAppendingSelectedText) {
    // Containing {selectedText} means the prompt was using the custom prompt
    // processor way of handling the selected text. No need to go through the
    // legacy placeholder.
    return processedPrompt;
  }

  // This is the legacy custom command selected text placeholder. It replaced
  // {copilot-selection} in the prompt with the selected text. This is different
  // from the custom prompt processor which uses {} in the prompt and appends
  // the selected text to the prompt. We cannot change user's custom commands
  // that have the old placeholder, so we need to support both.
  // Also, selected text is required for custom commands. If neither `{}` nor
  // `{copilot-selection}` is found, append the selected text to the prompt.
  const index = processedPrompt.indexOf(LEGACY_SELECTED_TEXT_PLACEHOLDER);
  if (index === -1) {
    return processedPrompt + "\n\n" + selectedText;
  }
  return (
    processedPrompt.slice(0, index) +
    selectedText +
    processedPrompt.slice(index + LEGACY_SELECTED_TEXT_PLACEHOLDER.length)
  );
}

export function hasModifiedCommand() {
  const commands = getInlineEditCommands();
  const defaultCommands = DEFAULT_INLINE_EDIT_COMMANDS;
  return commands !== defaultCommands;
}
