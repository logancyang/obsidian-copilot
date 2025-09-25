import { useMemo } from "react";
import { TFile } from "obsidian";

/**
 * Custom hook to get all available notes from the vault.
 * Includes PDF files when in Copilot Plus mode.
 *
 * @param isCopilotPlus - Whether Copilot Plus features are enabled
 * @returns Array of TFile objects (markdown files + PDFs in Plus mode)
 */
export function useAllNotes(isCopilotPlus: boolean = false): TFile[] {
  return useMemo(() => {
    if (!app?.vault) return [];
    const markdownFiles = app.vault.getMarkdownFiles() as TFile[];

    // Include PDF files in Plus mode
    if (isCopilotPlus) {
      const allFiles = app.vault.getFiles();
      const pdfFiles = allFiles.filter(
        (file): file is TFile => file instanceof TFile && file.extension === "pdf"
      );
      return [...markdownFiles, ...pdfFiles];
    }

    return markdownFiles;
  }, [isCopilotPlus]);
}
