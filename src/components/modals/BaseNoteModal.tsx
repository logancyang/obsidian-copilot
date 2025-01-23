import { App, FuzzySuggestModal, TFile, FuzzyMatch } from "obsidian";

export abstract class BaseNoteModal<T> extends FuzzySuggestModal<T> {
  protected activeNote: TFile | null;
  protected availableNotes: T[];

  constructor(app: App) {
    super(app);
    this.activeNote = app.workspace.getActiveFile();
  }

  protected getOrderedNotes(excludeNotePaths: string[] = []): TFile[] {
    // Get recently opened files first
    const recentFiles = this.app.workspace
      .getLastOpenFiles()
      .map((filePath) => this.app.vault.getAbstractFileByPath(filePath))
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          (file.extension === "md" || file.extension === "pdf") &&
          !excludeNotePaths.includes(file.path) &&
          file.path !== this.activeNote?.path
      );

    // Get all other files that weren't recently opened
    const allFiles = this.app.vault
      .getFiles()
      .filter((file) => file.extension === "md" || file.extension === "pdf");

    const otherFiles = allFiles.filter(
      (file) =>
        !recentFiles.some((recent) => recent.path === file.path) &&
        !excludeNotePaths.includes(file.path) &&
        file.path !== this.activeNote?.path
    );

    // Combine active note (if exists) with recent files and other files
    return [...(this.activeNote ? [this.activeNote] : []), ...recentFiles, ...otherFiles];
  }

  protected formatNoteTitle(basename: string, isActive: boolean, extension?: string): string {
    let title = basename;
    if (isActive) {
      title += " (current)";
    }
    if (extension === "pdf") {
      title += " (PDF)";
    }
    return title;
  }

  renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement) {
    const suggestionEl = el.createDiv({ cls: "suggestion-item pointer-events-none" });
    const titleEl = suggestionEl.createDiv({ cls: "suggestion-title" });
    const pathEl = suggestionEl.createDiv({ cls: "suggestion-path mt-1 text-muted text-xs" });

    if (match.item instanceof TFile) {
      const file = match.item;
      titleEl.setText(
        this.formatNoteTitle(file.basename, file === this.activeNote, file.extension)
      );
      pathEl.setText(file.path);
    }
  }
}
