import { useState, useEffect } from "react";
import { TFile, TAbstractFile } from "obsidian";

/**
 * Custom hook to get all available notes from the vault.
 * Includes PDF files when in Copilot Plus mode.
 * Automatically updates when files are created, deleted, or renamed.
 *
 * @param isCopilotPlus - Whether Copilot Plus features are enabled
 * @returns Array of TFile objects (markdown files + PDFs in Plus mode)
 */
export function useAllNotes(isCopilotPlus: boolean = false): TFile[] {
  const [files, setFiles] = useState<TFile[]>(() => {
    if (!app?.vault) return [];
    const markdownFiles = app.vault.getMarkdownFiles() as TFile[];

    if (isCopilotPlus) {
      const allFiles = app.vault.getFiles();
      const pdfFiles = allFiles.filter(
        (file): file is TFile => file instanceof TFile && file.extension === "pdf"
      );
      return [...markdownFiles, ...pdfFiles];
    }

    return markdownFiles;
  });

  useEffect(() => {
    if (!app?.vault) return;

    const refreshFiles = () => {
      const markdownFiles = app.vault.getMarkdownFiles() as TFile[];

      if (isCopilotPlus) {
        const allFiles = app.vault.getFiles();
        const pdfFiles = allFiles.filter(
          (file): file is TFile => file instanceof TFile && file.extension === "pdf"
        );
        setFiles([...markdownFiles, ...pdfFiles]);
      } else {
        setFiles(markdownFiles);
      }
    };

    const onCreate = (file: TAbstractFile) => {
      if (file instanceof TFile) {
        if (file.extension === "md" || (isCopilotPlus && file.extension === "pdf")) {
          refreshFiles();
        }
      }
    };

    const onDelete = (file: TAbstractFile) => {
      if (file instanceof TFile) {
        if (file.extension === "md" || (isCopilotPlus && file.extension === "pdf")) {
          refreshFiles();
        }
      }
    };

    const onRename = (file: TAbstractFile) => {
      if (file instanceof TFile) {
        if (file.extension === "md" || (isCopilotPlus && file.extension === "pdf")) {
          refreshFiles();
        }
      }
    };

    app.vault.on("create", onCreate);
    app.vault.on("delete", onDelete);
    app.vault.on("rename", onRename);

    return () => {
      app.vault.off("create", onCreate);
      app.vault.off("delete", onDelete);
      app.vault.off("rename", onRename);
    };
  }, [isCopilotPlus]);

  return files;
}
