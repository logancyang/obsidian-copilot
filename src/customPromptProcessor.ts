import { CustomError } from "@/error";
import { createPromptUsageStrategy, PromptUsageStrategy } from "@/promptUsageStrategy";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import {
  extractNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { normalizePath, Notice, TFile, Vault } from "obsidian";
import { NOTE_CONTEXT_PROMPT_TAG } from "./constants";

export interface CustomPrompt {
  title: string;
  content: string;
  showInContextMenu: boolean;
  filePath: string; // Add file path to enable updates
}

/**
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
 * Extract variables from a custom prompt and get their content and associated files.
 */
async function extractVariablesFromPrompt(
  customPrompt: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<{ variablesMap: Map<string, string>; includedFiles: Set<TFile> }> {
  const variablesMap = new Map<string, string>();
  const includedFiles = new Set<TFile>();
  let match;

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

export class CustomPromptProcessor {
  private static instance: CustomPromptProcessor;
  private usageStrategy: PromptUsageStrategy;

  private constructor(private vault: Vault) {
    this.usageStrategy = createPromptUsageStrategy();

    subscribeToSettingsChange(() => {
      this.usageStrategy = createPromptUsageStrategy();
    });
  }

  get customPromptsFolder(): string {
    return getSettings().customPromptsFolder;
  }

  static getInstance(vault: Vault): CustomPromptProcessor {
    if (!CustomPromptProcessor.instance) {
      CustomPromptProcessor.instance = new CustomPromptProcessor(vault);
    }
    return CustomPromptProcessor.instance;
  }

  recordPromptUsage(title: string) {
    this.usageStrategy.recordUsage(title);
  }

  async getAllPrompts(): Promise<CustomPrompt[]> {
    const folder = this.customPromptsFolder;
    const files = this.vault
      .getFiles()
      .filter((file) => file.path.startsWith(folder) && file.extension === "md");

    const prompts: CustomPrompt[] = [];
    for (const file of files) {
      const content = await this.vault.read(file);
      const metadata = app.metadataCache.getFileCache(file);
      const showInContextMenu =
        metadata?.frontmatter?.["copilot-command-context-menu-enabled"] ?? false;

      prompts.push({
        title: file.basename,
        content,
        showInContextMenu,
        filePath: file.path,
      });
    }

    // Clean up promptUsageTimestamps
    this.usageStrategy.removeUnusedPrompts(prompts.map((prompt) => prompt.title));

    return prompts.sort((a, b) => this.usageStrategy.compare(b.title, a.title) || 0);
  }

  async getPrompt(title: string): Promise<CustomPrompt | null> {
    const filePath = `${this.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const content = await this.vault.read(file);
      const metadata = app.metadataCache.getFileCache(file);
      const showInContextMenu =
        metadata?.frontmatter?.["copilot-command-context-menu-enabled"] ?? false;

      return {
        title: file.basename,
        content: content,
        showInContextMenu: showInContextMenu,
        filePath: file.path,
      };
    }
    return null;
  }

  async savePrompt(title: string, content: string): Promise<void> {
    const folderPath = normalizePath(this.customPromptsFolder);
    const filePath = `${folderPath}/${title}.md`;

    // Check if the folder exists and create it if it doesn't
    const folderExists = await this.vault.adapter.exists(folderPath);
    if (!folderExists) {
      await this.vault.createFolder(folderPath);
    }

    // Create the file
    await this.vault.create(filePath, content);
  }

  async updatePrompt(originTitle: string, newTitle: string, content: string): Promise<void> {
    const filePath = `${this.customPromptsFolder}/${originTitle}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);

    if (file instanceof TFile) {
      if (originTitle !== newTitle) {
        const newFilePath = `${this.customPromptsFolder}/${newTitle}.md`;
        const newFileExists = this.vault.getAbstractFileByPath(newFilePath);

        if (newFileExists) {
          throw new CustomError(
            "Error saving custom prompt. Please check if the title already exists."
          );
        }

        this.usageStrategy.updateUsage(originTitle, newTitle);
        await this.vault.rename(file, newFilePath);
      }
      await this.vault.modify(file, content);
    }
  }

  async deletePrompt(title: string): Promise<void> {
    const filePath = `${this.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      this.usageStrategy.removeUnusedPrompts([title]);
      await this.vault.delete(file);
    }
  }

  async updatePromptContextMenuSetting(
    filePath: string,
    showInContextMenu: boolean
  ): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${filePath}`);
    }

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Update the enabled property directly
      frontmatter["copilot-command-context-menu-enabled"] = showInContextMenu;
    });
  }

  /**
   * Process a custom prompt by replacing variables, adding note contents,
   * and tracking which files were included.
   *
   * @param {string} customPrompt - the custom prompt template
   * @param {string} selectedText - the text selected by the user
   * @param {TFile} [activeNote] - the currently active note (optional)
   * @return {Promise<ProcessedPromptResult>} An object containing the processed prompt string
   *                                         and an array of TFile objects included.
   */
  async processCustomPrompt(
    customPrompt: string,
    selectedText: string,
    activeNote?: TFile
  ): Promise<ProcessedPromptResult> {
    // Remove dependency on lastProcessedPrompt state
    return processPrompt(customPrompt, selectedText, this.vault, activeNote);
  }
}
