import {
  COMMAND_NAME_MAX_LENGTH,
  DEFAULT_INLINE_EDIT_COMMANDS,
  SELECTED_TEXT_PLACEHOLDER,
} from "@/commands/constants";
import { InlineEditCommandSettings, getSettings, useSettingsValue } from "@/settings/model";

export function getCommandId(commandName: string) {
  return commandName.replace(/\s+/g, "-").toLowerCase();
}

/**
 * Validate the command name. A command name must be:
 * - less than 50 characters
 * - not empty
 * - only contain alphanumeric characters and spaces
 * @param commandName - The name of the command.
 */
export function validateCommandName(commandName: string) {
  if (!commandName) {
    throw new Error("Command name is required");
  }

  if (commandName.length > COMMAND_NAME_MAX_LENGTH) {
    throw new Error(`Command name must be less than ${COMMAND_NAME_MAX_LENGTH} characters`);
  }

  if (!/^[a-zA-Z0-9\s]+$/.test(commandName)) {
    throw new Error("Command name must only contain alphanumeric characters and spaces");
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
 * Replace the {copilot-selection} placeholder with the selected text.
 * If the placeholder is not found, append the selected text to the prompt.
 */
export function processCommandPrompt(prompt: string, selectedText: string) {
  const index = prompt.indexOf(SELECTED_TEXT_PLACEHOLDER);
  if (index === -1) {
    return prompt + "\n\n" + selectedText;
  }
  return (
    prompt.slice(0, index) + selectedText + prompt.slice(index + SELECTED_TEXT_PLACEHOLDER.length)
  );
}
