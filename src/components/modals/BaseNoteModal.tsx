import { App, FuzzySuggestModal, TFile } from "obsidian";
import { isAllowedFileForNoteContext } from "@/utils";

export abstract class BaseNoteModal<T> extends FuzzySuggestModal<T> {
  protected activeNote: TFile | null;
  protected availableNotes: T[];

  constructor(app: App) {
    super(app);
    this.activeNote = app.workspace.getActiveFile();
  }

  protected getOrderedNotes(excludeNotePaths: string[] = []): TFile[] {
    const recentFiles = this.app.workspace
      .getLastOpenFiles()
      .map((filePath) => this.app.vault.getAbstractFileByPath(filePath))
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          isAllowedFileForNoteContext(file) &&
          !excludeNotePaths.includes(file.path) &&
          file.path !== this.activeNote?.path
      );

    const allFiles = this.app.vault.getFiles().filter((file) => isAllowedFileForNoteContext(file));

    const otherFiles = allFiles.filter(
      (file) =>
        !recentFiles.some((recent) => recent.path === file.path) &&
        !excludeNotePaths.includes(file.path) &&
        file.path !== this.activeNote?.path
    );

    const activeNoteArray =
      this.activeNote && isAllowedFileForNoteContext(this.activeNote) ? [this.activeNote] : [];
    return [...activeNoteArray, ...recentFiles, ...otherFiles];
  }

  protected formatNoteTitle(basename: string, isActive: boolean, extension?: string): string {
    let title = basename;
    if (isActive) {
      title += " (current)";
    }
    if (extension === "pdf") {
      title += " (PDF)";
    } else if (extension === "canvas") {
      title += " (Canvas)";
    }
    return title;
  }
}
