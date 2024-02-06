import { getFileContent, getFileName, getNotesFromPath, processVariableName } from '@/utils';
import { Notice, Vault } from 'obsidian';

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
      const processedVariableName = processVariableName(variableName);
      const noteFiles = await getNotesFromPath(this.vault, processedVariableName);
      const notes = [];

      for (const file of noteFiles) {
        const content = await getFileContent(file);
        if (content) {
          notes.push({ name: getFileName(file), content });
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
    let index = 0; // Start with 0 for noteCollection0, noteCollection1, etc.

    // Replace placeholders with noteCollectionX
    processedPrompt = processedPrompt.replace(/\{([^}]+)\}/g, () => {
      return `{noteCollection${index++}}`;
    });

    let additionalInfo = '';
    if (processedPrompt.includes('{}')) {
      // Replace {} with {selectedText}
      processedPrompt = processedPrompt.replace(/\{\}/g, '{selectedText}');
      additionalInfo += `selectedText:\n\n ${selectedText}`;
    }

    for (let i = 0; i < index; i++) {
      additionalInfo += `\n\nnoteCollection${i}:\n\n ${variablesWithContent[i]}`;
    }

    return processedPrompt + '\n\n' + additionalInfo;
  }
}
