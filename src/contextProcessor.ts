import { ChainType } from "@/chainFactory";
import { FileParserManager } from "@/tools/FileParserManager";
import { TFile, Vault } from "obsidian";

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
          content = content.replace(match[0], `\n\nEmbedded PDF (${pdfName}):\n${pdfContent}\n\n`);
        } catch (error) {
          console.error(`Error processing embedded PDF ${pdfName}:`, error);
          content = content.replace(
            match[0],
            `\n\nEmbedded PDF (${pdfName}): [Error: Could not process PDF]\n\n`
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

    const processNote = async (note: TFile) => {
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

        additionalContext += `\n\n <note_in_context> \n Title: [[${note.basename}]]\nPath: ${note.path}\n\n${content}\n</note_in_context>`;
      } catch (error) {
        console.error(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n <note_in_context_error> \n Title: [[${note.basename}]]\nPath: ${note.path}\n\n[Error: Could not process file]\n</note_in_context_error>`;
      }
    };

    // Process active note if included
    if (includeActiveNote && activeNote) {
      await processNote(activeNote);
    }

    const includedFilePaths = new Set<string>();
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
}
