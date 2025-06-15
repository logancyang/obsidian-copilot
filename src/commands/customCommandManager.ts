import { getSettings } from "@/settings/model";
import {
  extractNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { Notice, TFile, Vault } from "obsidian";
import { NOTE_CONTEXT_PROMPT_TAG } from "../constants";
import { getCommandFilePath, getCustomCommandsFolder } from "@/commands/customCommandUtils";
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
  createCommandInStore,
  customCommandsAtom,
  customCommandsStore,
  deleteCommandFromStore,
  updateCommandInStore,
} from "./state";

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

export class CustomCommandManager {
  private static instance: CustomCommandManager;

  static getInstance(): CustomCommandManager {
    if (!CustomCommandManager.instance) {
      CustomCommandManager.instance = new CustomCommandManager();
    }
    return CustomCommandManager.instance;
  }

  async createCommand(title: string, content: string): Promise<void> {
    createCommandInStore(title);
    const folderPath = getCustomCommandsFolder();
    const filePath = getCommandFilePath(title);

    // Check if the folder exists and create it if it doesn't
    const folderExists = await app.vault.adapter.exists(folderPath);
    if (!folderExists) {
      await app.vault.createFolder(folderPath);
    }

    const file = await app.vault.create(filePath, content);
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = false;
      frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = false;
      frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = Number.MAX_SAFE_INTEGER;
      frontmatter[COPILOT_COMMAND_MODEL_KEY] = "";
      frontmatter[COPILOT_COMMAND_LAST_USED] = 0;
    });
  }

  async recordUsage(command: CustomCommand) {
    this.updateCommand({ ...command, lastUsedMs: Date.now() }, command.title);
  }

  async updateCommand(command: CustomCommand, prevCommandTitle: string, skipStoreUpdate = false) {
    if (!skipStoreUpdate) {
      updateCommandInStore(command, prevCommandTitle);
    }

    let commandFile = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
    // Verify whether the title has changed to decide whether to rename the file
    if (command.title !== prevCommandTitle) {
      const newFilePath = getCommandFilePath(command.title);
      const newFileExists = app.vault.getAbstractFileByPath(newFilePath);
      if (newFileExists) {
        throw new CustomError(
          "Error saving custom prompt. Please check if the title already exists."
        );
      }
      const prevFilePath = getCommandFilePath(prevCommandTitle);
      const prevCommandFile = app.vault.getAbstractFileByPath(prevFilePath);
      if (prevCommandFile instanceof TFile) {
        await app.vault.rename(prevCommandFile, newFilePath);
        commandFile = prevCommandFile;
      }
    }

    if (!commandFile) {
      await this.createCommand(command.title, command.content);
      commandFile = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
    }

    if (commandFile instanceof TFile) {
      await app.vault.modify(commandFile, command.content);
      await app.fileManager.processFrontMatter(commandFile, (frontmatter) => {
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
        frontmatter[COPILOT_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
        frontmatter[COPILOT_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        frontmatter[COPILOT_COMMAND_MODEL_KEY] = command.modelKey;
        frontmatter[COPILOT_COMMAND_LAST_USED] = command.lastUsedMs;
      });
    }
  }

  async updateCommands(commands: CustomCommand[]) {
    customCommandsStore.set(customCommandsAtom, commands);
    await Promise.all(commands.map((command) => this.updateCommand(command, command.title, true)));
  }

  async deleteCommand(command: CustomCommand) {
    deleteCommandFromStore(command.title);
    const file = app.vault.getAbstractFileByPath(getCommandFilePath(command.title));
    if (file instanceof TFile) {
      await app.vault.delete(file);
    }
  }

  /**
   * Process a custom prompt by replacing variables, adding note contents,
   * and tracking which files were included.
   *
   * @param customPrompt - the custom prompt template
   * @param selectedText - the text selected by the user
   * @param activeNote - the currently active note (optional)
   * @return An object containing the processed prompt string and an array of TFile objects included.
   */
  async processCustomPrompt(
    customPrompt: string,
    selectedText: string,
    activeNote?: TFile
  ): Promise<ProcessedPromptResult> {
    // Remove dependency on lastProcessedPrompt state
    return processPrompt(customPrompt, selectedText, app.vault, activeNote);
  }
}
