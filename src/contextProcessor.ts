import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { FileParserManager } from "@/tools/FileParserManager";
import { TFile, Vault } from "obsidian";
import { NOTE_CONTEXT_PROMPT_TAG, EMBEDDED_PDF_TAG } from "./constants";
import { escapeXml } from "./utils/xmlUtils";

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
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${escapeXml(pdfName)}</name>\n<content>\n${escapeXml(pdfContent)}\n</content>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        } catch (error) {
          console.error(`Error processing embedded PDF ${pdfName}:`, error);
          content = content.replace(
            match[0],
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${escapeXml(pdfName)}</name>\n<error>Could not process PDF</error>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        }
      }
    }
    return content;
  }

  /**
   * Processes context notes, excluding any already handled by custom prompts.
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
        if (
          currentChain !== ChainType.COPILOT_PLUS_CHAIN &&
          note.extension !== "md" &&
          note.extension !== "canvas"
        ) {
          // This file type is supported, but requires Plus mode (e.g., PDF)
          console.warn(
            `File type ${note.extension} requires Copilot Plus mode for context processing.`
          );
          return;
        }

        // 3. If we reach here, parse the file (md, canvas, or other supported type in Plus mode)
        let content = await fileParserManager.parseFile(note, vault);

        // Special handling for embedded PDFs within markdown (only in Plus mode)
        if (note.extension === "md" && currentChain === ChainType.COPILOT_PLUS_CHAIN) {
          content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
        }

        // Get file metadata
        const stats = await vault.adapter.stat(note.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        additionalContext += `\n\n<${prompt_tag}>\n<title>${escapeXml(note.basename)}</title>\n<path>${escapeXml(note.path)}</path>\n<ctime>${escapeXml(ctime)}</ctime>\n<mtime>${escapeXml(mtime)}</mtime>\n<content>\n${escapeXml(content)}\n</content>\n</${prompt_tag}>`;
      } catch (error) {
        console.error(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n<${prompt_tag}_error>\n<title>${escapeXml(note.basename)}</title>\n<path>${escapeXml(note.path)}</path>\n<error>[Error: Could not process file]</error>\n</${prompt_tag}_error>`;
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
      additionalContext += `\n\n<selected_text>\n<title>${escapeXml(selectedText.noteTitle)}</title>\n<path>${escapeXml(selectedText.notePath)}</path>\n<start_line>${escapeXml(selectedText.startLine.toString())}</start_line>\n<end_line>${escapeXml(selectedText.endLine.toString())}</end_line>\n<content>\n${escapeXml(selectedText.content)}\n</content>\n</selected_text>`;
    }

    return additionalContext;
  }
}
