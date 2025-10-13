import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { RESTRICTION_MESSAGES } from "@/constants";
import { FileParserManager } from "@/tools/FileParserManager";
import { isPlusChain } from "@/utils";
import { TFile, Vault, Notice } from "obsidian";
import {
  NOTE_CONTEXT_PROMPT_TAG,
  EMBEDDED_PDF_TAG,
  SELECTED_TEXT_TAG,
  DATAVIEW_BLOCK_TAG,
} from "./constants";

export class ContextProcessor {
  private static instance: ContextProcessor;

  private constructor() {}

  static getInstance(): ContextProcessor {
    if (!ContextProcessor.instance) {
      ContextProcessor.instance = new ContextProcessor();
    }
    return ContextProcessor.instance;
  }

  async processEmbeddedPDFs(
    content: string,
    vault: Vault,
    fileParserManager: FileParserManager
  ): Promise<string> {
    const pdfRegex = /!\[\[(.*?\.pdf)\]\]/g;
    const matches = [...content.matchAll(pdfRegex)];

    for (const match of matches) {
      const pdfName = match[1];
      const pdfFile = vault.getAbstractFileByPath(pdfName);

      if (pdfFile instanceof TFile) {
        try {
          const pdfContent = await fileParserManager.parseFile(pdfFile, vault);
          content = content.replace(
            match[0],
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${pdfName}</name>\n<content>\n${pdfContent}\n</content>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        } catch (error) {
          console.error(`Error processing embedded PDF ${pdfName}:`, error);
          content = content.replace(
            match[0],
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${pdfName}</name>\n<error>Could not process PDF</error>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        }
      }
    }
    return content;
  }

  /**
   * Process Dataview blocks in content, executing queries and replacing them with structured results
   */
  async processDataviewBlocks(content: string, sourcePath: string): Promise<string> {
    // Check if Dataview plugin is available
    const dataviewPlugin = (app as any).plugins?.plugins?.dataview;
    if (!dataviewPlugin) {
      return content; // Dataview not installed, return content as-is
    }

    const dataviewApi = dataviewPlugin.api;
    if (!dataviewApi) {
      return content; // API not available
    }

    // Match dataview and dataviewjs code blocks
    // Fixed regex: \s* handles trailing spaces and different line endings
    const blockRegex = /```(dataview|dataviewjs)\s*\n([\s\S]*?)```/g;
    const matches = [...content.matchAll(blockRegex)];

    // Process matches in reverse order to avoid position shifts when replacing
    // This also handles multiple identical blocks correctly
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const queryType = match[1]; // 'dataview' or 'dataviewjs'
      const query = match[2].trim();
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;

      try {
        // Execute query with timeout
        const result = await Promise.race([
          this.executeDataviewQuery(dataviewApi, query, queryType, sourcePath),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 5000)),
        ]);

        // Replace block with structured output using slice (position-based, handles duplicates)
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<executed_result>\n${result}\n</executed_result>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      } catch (error) {
        console.error(`Error executing Dataview query:`, error);
        // On error, include query with error message
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<error>${error instanceof Error ? error.message : "Query execution failed"}</error>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      }
    }

    return content;
  }

  /**
   * Execute a Dataview query and format the results
   */
  private async executeDataviewQuery(
    dataviewApi: any,
    query: string,
    queryType: string,
    sourcePath: string
  ): Promise<string> {
    if (queryType === "dataviewjs") {
      // DataviewJS requires more complex handling - for now, return a message
      return "[DataviewJS execution not yet supported - showing original query]";
    }

    // Parse and execute DQL query
    const result = await dataviewApi.query(query, sourcePath);

    if (!result.successful) {
      throw new Error(result.error || "Query failed");
    }

    // Format results based on type
    return this.formatDataviewResult(result.value);
  }

  /**
   * Format Dataview query results into readable text
   */
  private formatDataviewResult(result: any): string {
    if (!result) {
      return "No results";
    }

    // Handle different result types
    if (result.type === "list") {
      return this.formatDataviewList(result.values);
    } else if (result.type === "table") {
      return this.formatDataviewTable(result.headers, result.values);
    } else if (result.type === "task") {
      return this.formatDataviewTasks(result.values);
    } else if (Array.isArray(result)) {
      return result.map((item) => this.formatDataviewValue(item)).join("\n");
    }

    return String(result);
  }

  /**
   * Format Dataview list results
   */
  private formatDataviewList(values: any[]): string {
    if (!values || values.length === 0) {
      return "No results";
    }
    return values.map((item) => `- ${this.formatDataviewValue(item)}`).join("\n");
  }

  /**
   * Format Dataview table results
   */
  private formatDataviewTable(headers: string[], rows: any[][]): string {
    if (!rows || rows.length === 0) {
      return "No results";
    }

    // Create markdown table
    let table = `| ${headers.join(" | ")} |\n`;
    table += `| ${headers.map(() => "---").join(" | ")} |\n`;

    for (const row of rows) {
      table += `| ${row.map((cell) => this.formatDataviewValue(cell)).join(" | ")} |\n`;
    }

    return table;
  }

  /**
   * Format Dataview task results
   */
  private formatDataviewTasks(tasks: any[]): string {
    if (!tasks || tasks.length === 0) {
      return "No results";
    }
    return tasks
      .map((task) => {
        const checkbox = task.completed ? "[x]" : "[ ]";
        return `- ${checkbox} ${this.formatDataviewValue(task.text || task)}`;
      })
      .join("\n");
  }

  /**
   * Format individual Dataview values
   */
  private formatDataviewValue(value: any): string {
    if (value === null || value === undefined) {
      return "";
    }

    // Handle links
    if (value && typeof value === "object" && value.path) {
      return `[[${value.path}]]`;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.formatDataviewValue(v)).join(", ");
    }

    return String(value);
  }

  /**
   * Processes context notes, excluding any already handled by custom prompts.
   *
   * NOTE: This method reads and includes note content as-is. URLs within note content
   * are NOT extracted or processed with url4llm. Only URLs directly typed in the user's
   * chat input are processed, not URLs that happen to be in the content of context notes.
   *
   * @param excludedNotePaths A set of file paths that should be skipped.
   * @param fileParserManager
   * @param vault
   * @param contextNotes
   * @param includeActiveNote
   * @param activeNote
   * @param currentChain
   * @returns The combined content string of the processed context notes.
   */
  async processContextNotes(
    excludedNotePaths: Set<string>,
    fileParserManager: FileParserManager,
    vault: Vault,
    contextNotes: TFile[],
    includeActiveNote: boolean,
    activeNote: TFile | null,
    currentChain: ChainType
  ): Promise<string> {
    let additionalContext = "";

    const processNote = async (note: TFile, prompt_tag: string = NOTE_CONTEXT_PROMPT_TAG) => {
      try {
        // Check if this note was already processed (via custom prompt)
        if (excludedNotePaths.has(note.path)) {
          console.log(`Skipping note ${note.path} as it was included via custom prompt.`);
          return;
        }

        console.log(
          `Processing note: ${note.path}, extension: ${note.extension}, chain: ${currentChain}`
        );

        // 1. Check if the file extension is supported by any parser
        if (!fileParserManager.supportsExtension(note.extension)) {
          console.warn(`Unsupported file type: ${note.extension}`);
          return;
        }

        // 2. Apply chain restrictions only to supported files that are NOT md or canvas
        if (!isPlusChain(currentChain) && note.extension !== "md" && note.extension !== "canvas") {
          // This file type is supported, but requires Plus mode (e.g., PDF)
          console.warn(
            `File type ${note.extension} requires Copilot Plus mode for context processing.`
          );
          // Show user-facing notice about the restriction
          new Notice(RESTRICTION_MESSAGES.NON_MARKDOWN_FILES_RESTRICTED);
          return;
        }

        // 3. If we reach here, parse the file (md, canvas, or other supported type in Plus mode)
        let content = await fileParserManager.parseFile(note, vault);

        // Special handling for markdown files
        if (note.extension === "md") {
          // Process embedded PDFs (only in Plus mode)
          if (isPlusChain(currentChain)) {
            content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
          }

          // Process Dataview blocks (all modes)
          content = await this.processDataviewBlocks(content, note.path);
        }

        // Get file metadata
        const stats = await vault.adapter.stat(note.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        additionalContext += `\n\n<${prompt_tag}>\n<title>${note.basename}</title>\n<path>${note.path}</path>\n<ctime>${ctime}</ctime>\n<mtime>${mtime}</mtime>\n<content>\n${content}\n</content>\n</${prompt_tag}>`;
      } catch (error) {
        console.error(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n<${prompt_tag}_error>\n<title>${note.basename}</title>\n<path>${note.path}</path>\n<error>[Error: Could not process file]</error>\n</${prompt_tag}_error>`;
      }
    };

    const includedFilePaths = new Set<string>();

    // Process active note if included
    if (includeActiveNote && activeNote) {
      await processNote(activeNote, "active_note");
      includedFilePaths.add(activeNote.path);
    }

    // Process context notes
    for (const note of contextNotes) {
      if (includedFilePaths.has(note.path)) {
        continue;
      }
      await processNote(note);
      includedFilePaths.add(note.path);
    }

    return additionalContext;
  }

  async hasEmbeddedPDFs(content: string): Promise<boolean> {
    const pdfRegex = /!\[\[(.*?\.pdf)\]\]/g;
    return pdfRegex.test(content);
  }

  async addNoteToContext(
    note: TFile,
    vault: Vault,
    contextNotes: TFile[],
    activeNote: TFile | null,
    setContextNotes: (notes: TFile[] | ((prev: TFile[]) => TFile[])) => void,
    setIncludeActiveNote: (include: boolean) => void
  ): Promise<void> {
    // Only check if the note exists in contextNotes
    if (contextNotes.some((existing) => existing.path === note.path)) {
      return; // Note already exists in context
    }

    // Read the note content
    const content = await vault.read(note);
    const hasEmbeddedPDFs = await this.hasEmbeddedPDFs(content);

    // Set includeActiveNote if it's the active note
    if (activeNote && note.path === activeNote.path) {
      setIncludeActiveNote(true);
    }

    // Add to contextNotes with wasAddedViaReference flag
    setContextNotes((prev: TFile[]) => [
      ...prev,
      Object.assign(note, {
        wasAddedViaReference: true,
        hasEmbeddedPDFs,
      }),
    ]);
  }

  processSelectedTextContexts(): string {
    const selectedTextContexts = getSelectedTextContexts();

    if (!selectedTextContexts || selectedTextContexts.length === 0) {
      return "";
    }

    let additionalContext = "";

    for (const selectedText of selectedTextContexts) {
      additionalContext += `\n\n<${SELECTED_TEXT_TAG}>\n<title>${selectedText.noteTitle}</title>\n<path>${selectedText.notePath}</path>\n<start_line>${selectedText.startLine.toString()}</start_line>\n<end_line>${selectedText.endLine.toString()}</end_line>\n<content>\n${selectedText.content}\n</content>\n</${SELECTED_TEXT_TAG}>`;
    }

    return additionalContext;
  }
}
