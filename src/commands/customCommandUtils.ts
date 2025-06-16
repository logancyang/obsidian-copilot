import {
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
  EMPTY_COMMAND,
  LEGACY_SELECTED_TEXT_PLACEHOLDER,
} from "@/commands/constants";
import { CustomCommand } from "@/commands/type";
import { normalizePath, Notice, TAbstractFile, TFile, Vault } from "obsidian";
import { getSettings } from "@/settings/model";
import { updateCachedCommands } from "./state";
import { PromptSortStrategy } from "@/types";
import {
  extractNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { NOTE_CONTEXT_PROMPT_TAG } from "@/constants";

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
  const showInContextMenu =
    metadata?.frontmatter?.[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] ??
    EMPTY_COMMAND.showInContextMenu;
  const showInSlashMenu =
    metadata?.frontmatter?.[COPILOT_COMMAND_SLASH_ENABLED] ?? EMPTY_COMMAND.showInSlashMenu;
  const lastUsedMs = metadata?.frontmatter?.[COPILOT_COMMAND_LAST_USED] ?? EMPTY_COMMAND.lastUsedMs;
  const order = metadata?.frontmatter?.[COPILOT_COMMAND_CONTEXT_MENU_ORDER] ?? EMPTY_COMMAND.order;
  const modelKey = metadata?.frontmatter?.[COPILOT_COMMAND_MODEL_KEY] ?? EMPTY_COMMAND.modelKey;

  return {
    title: file.basename,
    modelKey,
    content,
    showInContextMenu,
    showInSlashMenu,
    order,
    lastUsedMs,
  };
}

export async function loadAllCustomCommands(): Promise<CustomCommand[]> {
  const files = app.vault.getFiles().filter((file) => isCustomCommandFile(file));
  const commands: CustomCommand[] = await Promise.all(files.map(parseCustomCommandFile));
  updateCachedCommands(commands);
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

export function sortCommandsByRecency(commands: CustomCommand[]): CustomCommand[] {
  return [...commands].sort((a, b) => {
    if (a.lastUsedMs === b.lastUsedMs) {
      return a.title.localeCompare(b.title);
    }
    return b.lastUsedMs - a.lastUsedMs;
  });
}

export function sortCommandsByAlphabetical(commands: CustomCommand[]): CustomCommand[] {
  return [...commands].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Sort prompts of the slash commands based on the sort strategy.
 */
export function sortSlashCommands(commands: CustomCommand[]): CustomCommand[] {
  const sortStrategy = getSettings().promptSortStrategy;
  switch (sortStrategy) {
    case PromptSortStrategy.TIMESTAMP:
      return sortCommandsByRecency(commands);
    case PromptSortStrategy.ALPHABETICAL:
      return sortCommandsByAlphabetical(commands);
    case PromptSortStrategy.MANUAL:
      return sortCommandsByOrder(commands);
    default:
      return commands;
  }
}

/**
 * Process the custom command prompt. In addition to the regular prompt processing,
 * it handles legacy logic such as auto appending the selected text to the prompt
 * if it's not already present.
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
  if (index === -1 && selectedText.trim()) {
    return processedPrompt + "\n\n<selectedText>" + selectedText + "</selectedText>";
  }
  return (
    processedPrompt.slice(0, index) +
    selectedText +
    processedPrompt.slice(index + LEGACY_SELECTED_TEXT_PLACEHOLDER.length)
  );
}

/**
 * Find all variables between {} in a custom command prompt.
 * {copilot-selection} is the legacy custom command special placeholder. It must
 * be skipped when processing custom prompts because it's handled differently
 * by the custom command prompt processor.
 */
const VARIABLE_REGEX = /\{(?!copilot-selection\})([^}]+)\}/g;

/**
 * Represents the result of processing a custom prompt variable.
 */
interface VariableProcessingResult {
  content: string;
  files: TFile[];
}

/**
 * Extract variables from a custom prompt and get their content and associated
 * files.
 */
async function extractVariablesFromPrompt(
  customPrompt: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<{ variablesMap: Map<string, string>; includedFiles: Set<TFile> }> {
  const variablesMap = new Map<string, string>();
  const includedFiles = new Set<TFile>();
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_REGEX.exec(customPrompt)) !== null) {
    const variableName = match[1].trim();
    const variableResult: VariableProcessingResult = { content: "", files: [] };

    if (variableName.toLowerCase() === "activenote") {
      if (activeNote) {
        const content = await getFileContent(activeNote, vault);
        if (content) {
          variableResult.content = `## ${getFileName(activeNote)}\n\n${content}`;
          variableResult.files.push(activeNote);
        }
      } else {
        new Notice("No active note found.");
      }
    } else if (variableName.startsWith("#")) {
      // Handle tag-based variable for multiple tags
      const tagNames = variableName
        .slice(1)
        .split(",")
        .map((tag) => tag.trim());
      const noteFiles = await getNotesFromTags(vault, tagNames);
      const notesContent: string[] = [];
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notesContent.push(`## ${getFileName(file)}\n\n${content}`);
          variableResult.files.push(file);
        }
      }
      variableResult.content = notesContent.join("\n\n");
    } else {
      const processedVariableName = processVariableNameForNotePath(variableName);
      const noteFiles = await getNotesFromPath(vault, processedVariableName);
      const notesContent: string[] = [];
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notesContent.push(`## ${getFileName(file)}\n\n${content}`);
          variableResult.files.push(file);
        }
      }
      variableResult.content = notesContent.join("\n\n");
    }

    if (variableResult.content) {
      variablesMap.set(variableName, variableResult.content);
      variableResult.files.forEach((file) => includedFiles.add(file));
    } else if (variableName.toLowerCase() !== "activenote") {
      if (variableName.startsWith('"')) {
        // DO NOTHING as the user probably wants to write a JSON object
      } else {
        console.warn(`No notes found for variable: ${variableName}`);
      }
    }
  }

  return { variablesMap, includedFiles };
}

/**
 * Represents the result of processing a custom prompt.
 */
export interface ProcessedPromptResult {
  processedPrompt: string;
  includedFiles: TFile[];
}

/**
 * Process a custom prompt by replacing variables and adding note contents.
 * Returns the processed prompt string and a list of files included in the processing.
 */
export async function processPrompt(
  customPrompt: string,
  selectedText: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<ProcessedPromptResult> {
  const settings = getSettings();
  const includedFiles = new Set<TFile>();

  if (!settings.enableCustomPromptTemplating) {
    // If templating is disabled, check if activeNote should be included for {}
    if (customPrompt.includes("{}") && !selectedText && activeNote) {
      includedFiles.add(activeNote);
    }
    return {
      processedPrompt: customPrompt + "\n\n",
      includedFiles: Array.from(includedFiles),
    };
  }

  // Extract variables and track files included through them
  const { variablesMap, includedFiles: variableFiles } = await extractVariablesFromPrompt(
    customPrompt,
    vault,
    activeNote
  );
  variableFiles.forEach((file) => includedFiles.add(file));

  let processedPrompt = customPrompt;
  let additionalInfo = "";
  let activeNoteContent: string | null = null;

  if (processedPrompt.includes("{}")) {
    processedPrompt = processedPrompt.replace(/\{\}/g, "{selectedText}");
    if (selectedText) {
      additionalInfo += `selectedText:\n\n${selectedText}`;
      // Note: selectedText doesn't directly correspond to a file inclusion here
    } else if (activeNote) {
      activeNoteContent = await getFileContent(activeNote, vault);
      additionalInfo += `selectedText (entire active note):\n\n${activeNoteContent}`;
      includedFiles.add(activeNote); // Ensure active note is tracked if used for {}
    } else {
      additionalInfo += `selectedText:\n\n(No selected text or active note available)`;
    }
  }

  // Add variable contents to the additional info
  // The files are already tracked via includedFiles set
  for (const [varName, content] of variablesMap.entries()) {
    if (varName.toLowerCase() === "activenote" && activeNoteContent !== null) {
      // Content already added via {} handling, but file tracking is done.
      continue;
    }
    if (additionalInfo) {
      additionalInfo += `\n\n${varName}:\n\n${content}`;
    } else {
      additionalInfo += `${varName}:\n\n${content}`;
    }
  }

  // Process [[note title]] syntax
  const noteLinkFiles = extractNoteFiles(processedPrompt, vault);
  for (const noteFile of noteLinkFiles) {
    // Check if this note wasn't already included via a variable
    // We use the Set's reference equality which works for TFile objects
    if (!includedFiles.has(noteFile)) {
      const noteContent = await getFileContent(noteFile, vault);
      if (noteContent) {
        const noteContext = `<${NOTE_CONTEXT_PROMPT_TAG}> \n Title: [[${noteFile.basename}]]\nPath: ${noteFile.path}\n\n${noteContent}\n</${NOTE_CONTEXT_PROMPT_TAG}>`;
        if (additionalInfo) {
          additionalInfo += `\n\n`;
        }
        additionalInfo += `${noteContext}`;
        includedFiles.add(noteFile); // Track files included via [[links]]
      }
    }
  }

  return {
    processedPrompt: additionalInfo
      ? `${processedPrompt}\n\n${additionalInfo}`
      : `${processedPrompt}\n\n`,
    includedFiles: Array.from(includedFiles),
  };
}
