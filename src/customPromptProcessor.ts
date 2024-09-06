import { CopilotSettings } from "@/settings/SettingsPage";
import {
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { normalizePath, Notice, TFile, Vault } from "obsidian";

// TODO: To be deprecated once PouchDB is removed
export interface CustomPromptDB {
  _id: string;
  _rev?: string;
  prompt: string;
}

export interface CustomPrompt {
  title: string;
  content: string;
}

export class CustomPromptProcessor {
  private vault: Vault;
  private settings: CopilotSettings;
  private static instance: CustomPromptProcessor | null = null;

  private constructor(vault: Vault, settings: CopilotSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  public static getInstance(vault: Vault, settings: CopilotSettings): CustomPromptProcessor {
    if (!CustomPromptProcessor.instance) {
      CustomPromptProcessor.instance = new CustomPromptProcessor(vault, settings);
    }
    return CustomPromptProcessor.instance;
  }

  async getAllPrompts(): Promise<CustomPrompt[]> {
    const folder = this.settings.customPromptsFolder;
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
    return prompts;
  }

  async getPrompt(title: string): Promise<CustomPrompt | null> {
    const filePath = `${this.settings.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const content = await this.vault.read(file);
      return { title, content };
    }
    return null;
  }

  async savePrompt(title: string, content: string): Promise<void> {
    const folderPath = normalizePath(this.settings.customPromptsFolder);
    const filePath = `${folderPath}/${title}.md`;

    // Check if the folder exists and create it if it doesn't
    const folderExists = await this.vault.adapter.exists(folderPath);
    if (!folderExists) {
      await this.vault.createFolder(folderPath);
    }

    // Create the file
    await this.vault.create(filePath, content);
  }

  async updatePrompt(title: string, content: string): Promise<void> {
    const filePath = `${this.settings.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.vault.modify(file, content);
    }
  }

  async deletePrompt(title: string): Promise<void> {
    const filePath = `${this.settings.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.vault.delete(file);
    }
  }

  /**
   * Extract variables and get their content.
   *
   * @param {CustomPrompt} doc - the custom prompt to process
   * @return {Promise<string[]>} the processed custom prompt
   */
  async extractVariablesFromPrompt(customPrompt: string): Promise<string[]> {
    const variablesWithContent: string[] = [];
    const variableRegex = /\{([^}]+)\}/g;
    let match;

    while ((match = variableRegex.exec(customPrompt)) !== null) {
      const variableName = match[1].trim();
      const notes = [];

      if (variableName.startsWith("#")) {
        // Handle tag-based variable for multiple tags
        const tagNames = variableName
          .slice(1)
          .split(",")
          .map((tag) => tag.trim());
        const noteFiles = await getNotesFromTags(this.vault, tagNames);
        for (const file of noteFiles) {
          const content = await getFileContent(file, this.vault);
          if (content) {
            notes.push({ name: getFileName(file), content });
          }
        }
      } else {
        const processedVariableName = processVariableNameForNotePath(variableName);
        const noteFiles = await getNotesFromPath(this.vault, processedVariableName);
        for (const file of noteFiles) {
          const content = await getFileContent(file, this.vault);
          if (content) {
            notes.push({ name: getFileName(file), content });
          }
        }
      }

      if (notes.length > 0) {
        variablesWithContent.push(JSON.stringify(notes));
      } else {
        new Notice(`Warning: No valid notes found for the provided path '${variableName}'.`);
      }
    }

    return variablesWithContent;
  }

  async processCustomPrompt(customPrompt: string, selectedText: string): Promise<string> {
    const variablesWithContent = await this.extractVariablesFromPrompt(customPrompt);
    let processedPrompt = customPrompt;
    const matches = [...processedPrompt.matchAll(/\{([^}]+)\}/g)];

    let additionalInfo = "";
    if (processedPrompt.includes("{}")) {
      // Replace {} with {selectedText}
      processedPrompt = processedPrompt.replace(/\{\}/g, "{selectedText}");
      additionalInfo += `selectedText:\n\n ${selectedText}`;
    }

    for (let i = 0; i < variablesWithContent.length; i++) {
      if (matches[i]) {
        const varname = matches[i][1];
        additionalInfo += `\n\n${varname}:\n\n${variablesWithContent[i]}`;
      }
    }

    return processedPrompt + "\n\n" + additionalInfo;
  }
}
