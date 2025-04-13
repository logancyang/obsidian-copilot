import { CustomError } from "@/error";
import { TimestampUsageStrategy } from "@/promptUsageStrategy";
import { getSettings } from "@/settings/model";
import {
  extractNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { normalizePath, Notice, TFile, Vault } from "obsidian";

export interface CustomPrompt {
  title: string;
  content: string;
}

/**
 * {copilot-selection} is the legacy custom command special placeholder. It must
 * be skipped when processing custom prompts because it's handled differently
 * by the custom command prompt processor.
 */
const VARIABLE_REGEX = /\{(?!copilot-selection\})([^}]+)\}/g;

/**
 * Extract variables from a custom prompt and get their content.
 */
async function extractVariablesFromPrompt(
  customPrompt: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<string[]> {
  const variablesWithContent: string[] = [];
  let match;

  while ((match = VARIABLE_REGEX.exec(customPrompt)) !== null) {
    const variableName = match[1].trim();
    const notes = [];

    if (variableName.toLowerCase() === "activenote") {
      if (activeNote) {
        const content = await getFileContent(activeNote, vault);
        if (content) {
          notes.push({ name: getFileName(activeNote), content });
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
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notes.push({ name: getFileName(file), content });
        }
      }
    } else {
      const processedVariableName = processVariableNameForNotePath(variableName);
      const noteFiles = await getNotesFromPath(vault, processedVariableName);
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notes.push({ name: getFileName(file), content });
        }
      }
    }

    if (notes.length > 0) {
      const markdownContent = notes
        .map((note) => `## ${note.name}\n\n${note.content}`)
        .join("\n\n");
      variablesWithContent.push(markdownContent);
    } else {
      // If no notes are found, add an empty string to the variablesWithContent array
      // This prevents the subsequent variables from being mapped to the wrong index.
      variablesWithContent.push("");
      console.warn(`No notes found for variable: ${variableName}`);
    }
  }

  return variablesWithContent;
}

/**
 * Process a custom prompt by replacing variables and adding note contents.
 */
export async function processPrompt(
  customPrompt: string,
  selectedText: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<string> {
  const variablesWithContent = await extractVariablesFromPrompt(customPrompt, vault, activeNote);
  let processedPrompt = customPrompt;
  const matches = [...processedPrompt.matchAll(VARIABLE_REGEX)];

  let additionalInfo = "";
  let activeNoteContent: string | null = null;

  if (processedPrompt.includes("{}")) {
    processedPrompt = processedPrompt.replace(/\{\}/g, "{selectedText}");
    if (selectedText) {
      additionalInfo += `selectedText:\n\n ${selectedText}`;
    } else if (activeNote) {
      activeNoteContent = await getFileContent(activeNote, vault);
      additionalInfo += `selectedText (entire active note):\n\n ${activeNoteContent}`;
    } else {
      additionalInfo += `selectedText:\n\n (No selected text or active note available)`;
    }
  }

  for (let i = 0; i < variablesWithContent.length; i++) {
    if (matches[i]) {
      const varname = matches[i][1];
      if (varname.toLowerCase() === "activenote" && activeNoteContent) {
        // Skip adding activeNote content if it's already added as selectedText
        continue;
      }
      additionalInfo += `\n\n${varname}:\n\n${variablesWithContent[i]}`;
    }
  }

  // Process [[note title]] syntax with new reference system
  const noteFiles = extractNoteFiles(processedPrompt, vault);
  for (const noteFile of noteFiles) {
    // Check if this note wasn't already processed in extractVariablesFromPrompt
    if (!matches.some((match) => match[1].includes(`[[${noteFile.basename}]]`))) {
      const noteContent = await getFileContent(noteFile, vault);
      if (noteContent) {
        additionalInfo += `\n\nTitle: [[${noteFile.basename}]]\nPath: ${noteFile.path}\n\n${noteContent}`;
      }
    }
  }

  return processedPrompt + "\n\n" + additionalInfo;
}

export class CustomPromptProcessor {
  private static instance: CustomPromptProcessor;
  private usageStrategy: TimestampUsageStrategy;

  private constructor(private vault: Vault) {
    this.usageStrategy = new TimestampUsageStrategy();
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
      prompts.push({
        title: file.basename,
        content: content,
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
      return { title, content };
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

  /**
   * Extract variables from a custom prompt and get their content.
   * This is a wrapper around the module-level extractVariablesFromPrompt function.
   *
   * @param {string} customPrompt - the custom prompt to process
   * @param {TFile} [activeNote] - the currently active note (optional)
   * @return {Promise<string[]>} array of variable contents
   */
  public async extractVariablesFromPrompt(
    customPrompt: string,
    activeNote?: TFile
  ): Promise<string[]> {
    return extractVariablesFromPrompt(customPrompt, this.vault, activeNote);
  }

  /**
   * Process a custom prompt by tracking it and delegating to the module-level function.
   * This method updates the lastProcessedPrompt property before processing.
   *
   * @param {string} customPrompt - the custom prompt to process
   * @param {string} selectedText - the text selected by the user
   * @param {TFile} [activeNote] - the currently active note (optional)
   * @return {Promise<string>} the processed prompt with all variables replaced
   */
  async processCustomPrompt(
    customPrompt: string,
    selectedText: string,
    activeNote?: TFile
  ): Promise<string> {
    this.lastProcessedPrompt = customPrompt;
    return processPrompt(customPrompt, selectedText, this.vault, activeNote);
  }

  /**
   * Get a set of all variables that were processed in the last prompt.
   * @return {Promise<Set<string>>} A set of variable names that were processed
   * @deprecated Use the module-level processPrompt function which returns the processed content directly
   */
  async getProcessedVariables(): Promise<Set<string>> {
    const processedVars = new Set<string>();

    // Add variables from the last processed prompt
    const matches = this.lastProcessedPrompt?.matchAll(/\{(?!copilot-selection\})([^}]+)\}/g) || [];
    for (const match of matches) {
      processedVars.add(match[1]);
    }

    // Add explicitly referenced note titles
    const noteFiles = extractNoteFiles(this.lastProcessedPrompt || "", this.vault);
    for (const file of noteFiles) {
      processedVars.add(`[[${file.basename}]]`);
    }

    return processedVars;
  }

  private lastProcessedPrompt: string | null = null;
}
