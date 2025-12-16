import {
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
  COPILOT_COMMAND_LAST_USED,
  COPILOT_COMMAND_MODEL_KEY,
  COPILOT_COMMAND_SLASH_ENABLED,
  EMPTY_COMMAND,
  LEGACY_SELECTED_TEXT_PLACEHOLDER,
  QUICK_COMMAND_CODE_BLOCK,
} from "@/commands/constants";
import { CustomCommand } from "@/commands/type";
import { normalizePath, Notice, TAbstractFile, TFile, Vault, Editor } from "obsidian";
import { getSettings } from "@/settings/model";
import {
  updateCachedCommands,
  getCachedCustomCommands,
  addPendingFileWrite,
  removePendingFileWrite,
} from "./state";
import { PromptSortStrategy } from "@/types";
import {
  extractTemplateNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import {
  NOTE_CONTEXT_PROMPT_TAG,
  SELECTED_TEXT_TAG,
  VARIABLE_TAG,
  VARIABLE_NOTE_TAG,
} from "@/constants";

export function validateCommandName(
  name: string,
  commands: CustomCommand[],
  currentCommandName?: string
): string | null {
  const trimmedName = name.trim();

  if (currentCommandName && trimmedName === currentCommandName) {
    return null; // No change is allowed
  }

  if (!trimmedName) {
    return "Command name cannot be empty";
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

export function hasOrderFrontmatter(file: TFile): boolean {
  const metadata = app.metadataCache.getFileCache(file);
  return metadata?.frontmatter?.[COPILOT_COMMAND_CONTEXT_MENU_ORDER] != null;
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

  if (processedPrompt.includes(`{${SELECTED_TEXT_TAG}}`) || skipAppendingSelectedText) {
    // Containing {selected_text} means the prompt was using the custom prompt
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
    return (
      processedPrompt +
      "\n\n<" +
      SELECTED_TEXT_TAG +
      ">" +
      selectedText +
      "</" +
      SELECTED_TEXT_TAG +
      ">"
    );
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
 *
 * Also excludes {[[...]]} patterns which are handled separately by extractTemplateNoteFiles.
 */
const VARIABLE_REGEX = /\{(?!copilot-selection\}|\[\[)([^}]+)\}/g;

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
          variableResult.content = `<${VARIABLE_NOTE_TAG}>\n<path>${activeNote.path}</path>\n## ${getFileName(activeNote)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`;
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
          notesContent.push(
            `<${VARIABLE_NOTE_TAG}>\n<path>${file.path}</path>\n## ${getFileName(file)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`
          );
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
          notesContent.push(
            `<${VARIABLE_NOTE_TAG}>\n<path>${file.path}</path>\n## ${getFileName(file)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`
          );
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
    processedPrompt = processedPrompt.replace(/\{\}/g, `{${SELECTED_TEXT_TAG}}`);
    if (selectedText) {
      additionalInfo += `<${SELECTED_TEXT_TAG}>\n${selectedText}\n</${SELECTED_TEXT_TAG}>`;
      // Note: selectedText doesn't directly correspond to a file inclusion here
    } else if (activeNote) {
      activeNoteContent = await getFileContent(activeNote, vault);
      additionalInfo += `<${SELECTED_TEXT_TAG} type="active_note">\n${activeNoteContent || ""}\n</${SELECTED_TEXT_TAG}>`;
      includedFiles.add(activeNote); // Ensure active note is tracked if used for {}
    } else {
      additionalInfo += `<${SELECTED_TEXT_TAG}>\n(No selected text or active note available)\n</${SELECTED_TEXT_TAG}>`;
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
      additionalInfo += `\n\n<${VARIABLE_TAG} name="${varName}">\n${content}\n</${VARIABLE_TAG}>`;
    } else {
      additionalInfo += `<${VARIABLE_TAG} name="${varName}">\n${content}\n</${VARIABLE_TAG}>`;
    }
  }

  // Process {[[note title]]} syntax - only wikilinks wrapped in curly braces
  const noteLinkFiles = extractTemplateNoteFiles(processedPrompt, vault);
  for (const noteFile of noteLinkFiles) {
    // Check if this note wasn't already included via a variable
    // We use the Set's reference equality which works for TFile objects
    if (!includedFiles.has(noteFile)) {
      const noteContent = await getFileContent(noteFile, vault);
      if (noteContent) {
        // Get file metadata
        const stats = await vault.adapter.stat(noteFile.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        const noteContext = `<${NOTE_CONTEXT_PROMPT_TAG}>
<title>${noteFile.basename}</title>
<path>${noteFile.path}</path>
<ctime>${ctime}</ctime>
<mtime>${mtime}</mtime>
<content>
${noteContent}
</content>
</${NOTE_CONTEXT_PROMPT_TAG}>`;
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

/**
 * Generates a unique name for a copied command by adding "(copy)" or "(copy N)" suffix.
 */
export function generateCopyCommandName(
  originalName: string,
  existingCommands: CustomCommand[]
): string {
  const baseName = `${originalName} (copy)`;
  let copyName = baseName;
  let counter = 1;

  // Check if the base copy name already exists
  while (existingCommands.some((cmd) => cmd.title.toLowerCase() === copyName.toLowerCase())) {
    counter++;
    copyName = `${originalName} (copy ${counter})`;
  }

  return copyName;
}

/**
 * Returns the next order value for a new custom command, based on the cached commands.
 * If the last order is Number.MAX_SAFE_INTEGER, returns Number.MAX_SAFE_INTEGER.
 */
export function getNextCustomCommandOrder(): number {
  const commands = getCachedCustomCommands();
  const lastOrder = commands.reduce(
    (prev: number, curr: CustomCommand) => (prev > curr.order ? prev : curr.order),
    0
  );
  return lastOrder === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : lastOrder + 10;
}

/**
 * Ensures that the required frontmatter fields exist on the given file. Only
 * adds missing fields, does not overwrite existing values.
 * This is idempotent and does not touch the file content.
 */
export async function ensureCommandFrontmatter(file: TFile, command: CustomCommand) {
  try {
    addPendingFileWrite(file.path);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] == null) {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
      }
      if (frontmatter[COPILOT_COMMAND_SLASH_ENABLED] == null) {
        frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
      }
      if (frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] == null) {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
      }
      if (frontmatter[COPILOT_COMMAND_MODEL_KEY] == null) {
        frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
      }
      if (frontmatter[COPILOT_COMMAND_LAST_USED] == null) {
        frontmatter[COPILOT_COMMAND_LAST_USED] = command.lastUsedMs;
      }
    });
  } finally {
    removePendingFileWrite(file.path);
  }
}

/**
 * Removes all quick command code blocks from the editor while preserving cursor position and selection
 * @param editor - The Obsidian editor instance
 * @returns true if any blocks were removed, false otherwise
 */
export function removeQuickCommandBlocks(editor: Editor): boolean {
  // Store original selection positions
  const originalFrom = editor.getCursor("from");
  const originalTo = editor.getCursor("to");

  const content = editor.getValue();
  const lines = content.split("\n");
  let hasExisting = false;
  const newLines = [];
  let removedLinesBeforeFrom = 0;
  let removedLinesBeforeTo = 0;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === `\`\`\`${QUICK_COMMAND_CODE_BLOCK}`) {
      hasExisting = true;
      const blockStartLine = i;

      // Skip the opening line
      i++;
      // Skip until we find the closing ```
      while (i < lines.length && lines[i].trim() !== "```") {
        i++;
      }
      // Skip the closing line
      i++;

      const removedLineCount = i - blockStartLine;

      // Calculate how many lines were removed before the selection positions
      if (blockStartLine <= originalFrom.line) {
        removedLinesBeforeFrom += removedLineCount;
      }
      if (blockStartLine <= originalTo.line) {
        removedLinesBeforeTo += removedLineCount;
      }
    } else {
      newLines.push(lines[i]);
      i++;
    }
  }

  // Update editor content and restore selection if we removed existing blocks
  if (hasExisting) {
    editor.setValue(newLines.join("\n"));

    // Calculate new selection positions accounting for removed lines
    const newFromLine = Math.max(0, originalFrom.line - removedLinesBeforeFrom);
    const newToLine = Math.max(0, originalTo.line - removedLinesBeforeTo);

    // Restore the selection
    editor.setSelection(
      { line: newFromLine, ch: originalFrom.ch },
      { line: newToLine, ch: originalTo.ch }
    );
  }

  return hasExisting;
}
