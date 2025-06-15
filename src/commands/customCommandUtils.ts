import {
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
  SELECTED_TEXT_PLACEHOLDER as LEGACY_SELECTED_TEXT_PLACEHOLDER,
} from "@/commands/constants";
import { CustomCommand } from "@/commands/type";
import { processPrompt } from "@/commands/customCommandManager";
import { normalizePath, TAbstractFile, TFile } from "obsidian";
import { getSettings } from "@/settings/model";
import { customCommandsAtom, customCommandsStore } from "./state";

export function validateCommandName(
  name: string,
  commands: CustomCommand[],
  currentCommandName?: string
): string | null {
  const trimmedName = name.trim();

  if (currentCommandName && trimmedName === currentCommandName) {
    return null; // No change is allowed
  }

  // eslint-disable-next-line no-control-regex
  const invalidChars = /[#<>:"/\\|?*[\]^\x00-\x1F]/g;
  if (invalidChars.test(trimmedName)) {
    return 'Command name contains invalid characters. Avoid using: < > : " / \\ | ? * [ ] ^';
  }

  if (commands.some((cmd) => cmd.title.toLowerCase() === trimmedName.toLowerCase())) {
    return "A command with this name already exists";
  }

  return null;
}

/**
 * Converts a custom command name to a command id. Encodes the name to avoid
 * special characters.
 */
export function getCommandId(commandName: string) {
  return encodeURIComponent(commandName.toLowerCase());
}

export function getCustomCommandsFolder(): string {
  return normalizePath(getSettings().customPromptsFolder);
}

export function getCommandFilePath(title: string): string {
  return `${getCustomCommandsFolder()}/${title}.md`;
}

/**
 * Check if a file is a markdown file in the custom commands folder.
 */
export function isCustomCommandFile(file: TAbstractFile): boolean {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;
  const folder = getCustomCommandsFolder();
  if (!file.path.startsWith(folder + "/")) return false;
  // Only include direct children (no slashes in relative path)
  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.includes("/")) return false;
  return true;
}

/**
 * Utility to strip YAML frontmatter from markdown content.
 */
function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) {
      return content.slice(end + 3).trimStart();
    }
  }
  return content;
}

/**
 * Parse a TFile as a CustomCommand by reading its content and extracting frontmatter.
 */
export async function parseCustomCommandFile(file: TFile): Promise<CustomCommand> {
  const rawContent = await app.vault.read(file);
  const content = stripFrontmatter(rawContent);
  const metadata = app.metadataCache.getFileCache(file);
  const showInContextMenu = metadata?.frontmatter?.[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] ?? false;
  const slashCommandEnabled = metadata?.frontmatter?.[COPILOT_COMMAND_SLASH_ENABLED] ?? false;
  const order =
    metadata?.frontmatter?.[COPILOT_COMMAND_CONTEXT_MENU_ORDER] ?? Number.MAX_SAFE_INTEGER;
  const modelKey = metadata?.frontmatter?.[COPILOT_COMMAND_MODEL_KEY];

  return {
    title: file.basename,
    modelKey,
    content,
    showInContextMenu,
    showInSlashMenu: slashCommandEnabled,
    order: typeof order === "number" ? order : Number.MAX_SAFE_INTEGER,
  };
}

export async function loadAllCustomCommands(): Promise<CustomCommand[]> {
  const files = app.vault.getFiles().filter((file) => isCustomCommandFile(file));
  const commands: CustomCommand[] = await Promise.all(files.map(parseCustomCommandFile));
  customCommandsStore.set(customCommandsAtom, commands);
  return commands;
}

export function sortCommandsByOrder(commands: CustomCommand[]): CustomCommand[] {
  return [...commands].sort((a, b) => {
    if (a.order === b.order) {
      return a.title.localeCompare(b.title);
    }
    return a.order - b.order;
  });
}

export function sortCommandsByUsage(commands: CustomCommand[]): CustomCommand[] {
  // Not implemented yet, return the input as is
  return commands;
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
