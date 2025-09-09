import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { RESTRICTION_MESSAGES } from "@/constants";
import { FileParserManager } from "@/tools/FileParserManager";
import { isPlusChain } from "@/utils";
import { TFile, Vault, Notice, App } from "obsidian";
import { NOTE_CONTEXT_PROMPT_TAG, EMBEDDED_PDF_TAG, SELECTED_TEXT_TAG } from "./constants";
import { NoteReference } from "./types/note";
import { getRelevantNoteReferenceContent } from "./utils/noteUtils";

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

        // Special handling for embedded PDFs within markdown (only in Plus mode)
        if (note.extension === "md" && isPlusChain(currentChain)) {
          content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
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
    note: NoteReference,
    app: App,
    contextNotes: NoteReference[],
    activeNote: TFile | null,
    setContextNotes: (
      notes: NoteReference[] | ((prev: NoteReference[]) => NoteReference[])
    ) => void,
    setIncludeActiveNote: (include: boolean) => void
  ): Promise<void> {
    // Only check if the note exists in contextNotes
    if (contextNotes.some((existing) => existing.file.path === note.file.path)) {
      return; // Note already exists in context
    }

    // Read the relevant note content
    const relevantContent = await getRelevantNoteReferenceContent(app, note);
    const hasEmbeddedPDFs = await this.hasEmbeddedPDFs(relevantContent);

    // Set includeActiveNote if it's the active note
    if (activeNote && note.file.path === activeNote.path) {
      setIncludeActiveNote(true);
    }

    // Add to contextNotes with wasAddedViaReference flag
    note.addedVia = "reference";
    note.hasEmbeddedPDFs = hasEmbeddedPDFs;

    setContextNotes((prev: NoteReference[]) => [...prev, note]);
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
