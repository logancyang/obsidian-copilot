import { ChainType } from "@/chainFactory";
import { CustomPromptProcessor } from "@/customPromptProcessor";
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

  async processContextNotes(
    customPromptProcessor: CustomPromptProcessor,
    fileParserManager: FileParserManager,
    vault: Vault,
    contextNotes: TFile[],
    includeActiveNote: boolean,
    activeNote: TFile | null,
    currentChain: ChainType
  ): Promise<string> {
    const processedVars = await customPromptProcessor.getProcessedVariables();
    let additionalContext = "";

    const processNote = async (note: TFile) => {
      try {
        if (currentChain !== ChainType.COPILOT_PLUS_CHAIN && note.extension !== "md") {
          if (!fileParserManager.supportsExtension(note.extension)) {
            console.warn(`Unsupported file type: ${note.extension}`);
          } else {
            console.warn(`File type ${note.extension} only supported in Copilot Plus mode`);
          }
          return;
        }

        if (!fileParserManager.supportsExtension(note.extension)) {
          console.warn(`Unsupported file type: ${note.extension}`);
          return;
        }

        let content = await fileParserManager.parseFile(note, vault);

        if (note.extension === "md" && currentChain === ChainType.COPILOT_PLUS_CHAIN) {
          content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
        }

        additionalContext += `\n\n[[${note.basename}.${note.extension}]]:\n\n${content}`;
      } catch (error) {
        console.error(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n[[${note.basename}]]: [Error: Could not process file]`;
      }
    };

    // Process active note if included
    if (includeActiveNote && activeNote) {
      const activeNoteVar = `activeNote`;
      const activeNotePath = `[[${activeNote.basename}]]`;
      if (!processedVars.has(activeNoteVar) && !processedVars.has(activeNotePath)) {
        await processNote(activeNote);
      }
    }

    // Process context notes
    for (const note of contextNotes) {
      await processNote(note);
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
    // First check if this note can be added
    if (
      contextNotes.some((existing) => existing.path === note.path) ||
      (activeNote && note.path === activeNote.path)
    ) {
      return; // Note already exists in context
    }

    // Read the note content
    const content = await vault.read(note);
    const hasEmbeddedPDFs = await this.hasEmbeddedPDFs(content);

    // If it's the active note, set includeActiveNote to true
    if (activeNote && note.path === activeNote.path) {
      setIncludeActiveNote(true);
    } else {
      // Otherwise add it to contextNotes
      setContextNotes((prev: TFile[]) => [
        ...prev,
        Object.assign(note, {
          wasAddedViaReference: true,
          hasEmbeddedPDFs,
        }),
      ]);
    }
  }
}
