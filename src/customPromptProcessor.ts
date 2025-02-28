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
import { normalizePath, Notice, TFile, Vault, App } from "obsidian";

export interface CustomPrompt {
  title: string;
  content: string;
  model?: string;
  isTemporaryModel?: boolean;
}

export class CustomPromptProcessor {
  private static instance: CustomPromptProcessor | null = null;
  private vault: Vault;
  private usageStrategy: TimestampUsageStrategy;
  private app: App;

  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.usageStrategy = new TimestampUsageStrategy();
  }

  get customPromptsFolder(): string {
    return getSettings().customPromptsFolder;
  }

  static getInstance(app: App): CustomPromptProcessor {
    if (!CustomPromptProcessor.instance) {
      CustomPromptProcessor.instance = new CustomPromptProcessor(app);
    }
    return CustomPromptProcessor.instance;
  }

  private parseFrontMatter(
    file: TFile,
    content: string
  ): { frontmatter: { model?: string; isTemporaryModel?: boolean }; content: string } {
    // Get the cached frontmatter from Obsidian's metadata cache
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter as Record<string, unknown>) || {};

    // Handle both model and temp-model fields
    const tempModel = frontmatter["temp-model"] as string | undefined;
    const model = tempModel || (frontmatter.model as string | undefined);
    const isTemporaryModel = "temp-model" in frontmatter;

    // Get the content without frontmatter
    const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

    return {
      frontmatter: { model, isTemporaryModel },
      content: contentWithoutFrontmatter,
    };
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
      const rawContent = await this.vault.read(file);
      const { frontmatter, content } = this.parseFrontMatter(file, rawContent);
      prompts.push({
        title: file.basename,
        content: content,
        model: frontmatter.model,
        isTemporaryModel: frontmatter.isTemporaryModel,
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
      const rawContent = await this.vault.read(file);
      const { frontmatter, content } = this.parseFrontMatter(file, rawContent);
      return {
        title,
        content,
        model: frontmatter.model,
        isTemporaryModel: frontmatter.isTemporaryModel,
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

  /**
   * Extract variables and get their content.
   *
   * @param {CustomPrompt} doc - the custom prompt to process
   * @return {Promise<string[]>} the processed custom prompt
   */
  public async extractVariablesFromPrompt(
    customPrompt: string,
    activeNote?: TFile
  ): Promise<string[]> {
    const variablesWithContent: string[] = [];
    const variableRegex = /\{([^}]+)\}/g;
    let match;

    while ((match = variableRegex.exec(customPrompt)) !== null) {
      const variableName = match[1].trim();
      const notes = [];

      if (variableName.toLowerCase() === "activenote") {
        if (activeNote) {
          const content = await getFileContent(activeNote, this.vault);
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
        const markdownContent = notes
          .map((note) => `## ${note.name}\n\n${note.content}`)
          .join("\n\n");
        variablesWithContent.push(markdownContent);
      } else {
        console.warn(`No notes found for variable: ${variableName}`);
      }
    }

    return variablesWithContent;
  }

  // TODO: return the processed variables along with the processed prompt and
  // remove getProcessedVariables
  async processCustomPrompt(
    customPrompt: string,
    selectedText: string,
    activeNote?: TFile
  ): Promise<string> {
    this.lastProcessedPrompt = customPrompt;
    const variablesWithContent = await this.extractVariablesFromPrompt(customPrompt, activeNote);
    let processedPrompt = customPrompt;
    const matches = [...processedPrompt.matchAll(/\{([^}]+)\}/g)];

    let additionalInfo = "";
    let activeNoteContent: string | null = null;

    if (processedPrompt.includes("{}")) {
      processedPrompt = processedPrompt.replace(/\{\}/g, "{selectedText}");
      if (selectedText) {
        additionalInfo += `selectedText:\n\n ${selectedText}`;
      } else if (activeNote) {
        activeNoteContent = await getFileContent(activeNote, this.vault);
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
    const noteFiles = extractNoteFiles(processedPrompt, this.vault);
    for (const noteFile of noteFiles) {
      // Check if this note wasn't already processed in extractVariablesFromPrompt
      if (!matches.some((match) => match[1].includes(`[[${noteFile.basename}]]`))) {
        const noteContent = await getFileContent(noteFile, this.vault);
        if (noteContent) {
          additionalInfo += `\n\nTitle: [[${noteFile.basename}]]\nPath: ${noteFile.path}\n\n${noteContent}`;
        }
      }
    }

    return processedPrompt + "\n\n" + additionalInfo;
  }

  // TODO: remove this
  async getProcessedVariables(): Promise<Set<string>> {
    const processedVars = new Set<string>();

    // Add variables from the last processed prompt
    const matches = this.lastProcessedPrompt?.matchAll(/\{([^}]+)\}/g) || [];
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
