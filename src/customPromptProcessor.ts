import {
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { Notice, Vault } from "obsidian";

export interface CustomPrompt {
  _id: string;
  _rev?: string;
  prompt: string;
}

export class CustomPromptProcessor {
  private vault: Vault;
  private static instance: CustomPromptProcessor | null = null;
  private constructor(vault: Vault) {
    this.vault = vault;
  }

  public static getInstance(vault: Vault): CustomPromptProcessor {
    if (!CustomPromptProcessor.instance) {
      CustomPromptProcessor.instance = new CustomPromptProcessor(vault);
    }
    return CustomPromptProcessor.instance;
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
        const processedVariableName =
          processVariableNameForNotePath(variableName);
        const noteFiles = await getNotesFromPath(
          this.vault,
          processedVariableName
        );
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
        new Notice(
          `Warning: No valid notes found for the provided path '${variableName}'.`
        );
      }
    }

    return variablesWithContent;
  }

  async processCustomPrompt(
    customPrompt: string,
    selectedText: string
  ): Promise<string> {
    const variablesWithContent = await this.extractVariablesFromPrompt(
      customPrompt
    );
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
