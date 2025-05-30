import { App, FuzzyMatch, TFile } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";

interface ProjectFileSelectModalProps {
  app: App;
  onFileSelect: (file: TFile) => void;
  excludeFilePaths: string[];
  titleOnly?: boolean;
}

export class ProjectFileSelectModal extends BaseNoteModal<TFile> {
  private onFileSelect: (file: TFile) => void;
  private titleOnly: boolean;

  constructor({
    app,
    onFileSelect,
    excludeFilePaths,
    titleOnly = false,
  }: ProjectFileSelectModalProps) {
    super(app);
    this.onFileSelect = onFileSelect;
    this.availableNotes = this.getOrderedProjectFiles(excludeFilePaths);
    this.titleOnly = titleOnly;
    // @ts-ignore
    this.setTitle("Select File");
  }

  // Override to include all file types
  protected getOrderedProjectFiles(excludeFilePaths: string[] = []): TFile[] {
    // TODO(logan): Remove this once the backend fixes this
    const excludedExtensions = ["mp3", "mp4", "m4a", "wav", "webm"];
    // Get recently opened files first
    const recentFiles = this.app.workspace
      .getLastOpenFiles()
      .map((filePath) => this.app.vault.getAbstractFileByPath(filePath))
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          !excludeFilePaths.includes(file.path) &&
          file.path !== this.activeNote?.path &&
          !excludedExtensions.includes(file.extension.toLowerCase())
      );

    // Get all other files that weren't recently opened
    const allFiles = this.app.vault
      .getFiles()
      .filter((file) => !excludedExtensions.includes(file.extension.toLowerCase()));

    const otherFiles = allFiles.filter(
      (file) =>
        !recentFiles.some((recent) => recent.path === file.path) &&
        !excludeFilePaths.includes(file.path) &&
        file.path !== this.activeNote?.path
    );

    // Combine active note (if exists) with recent files and other files
    return [...(this.activeNote ? [this.activeNote] : []), ...recentFiles, ...otherFiles];
  }

  getItems(): TFile[] {
    if (this.titleOnly) {
      // Deduplicate files by basename
      const uniqueFiles = new Map<string, TFile>();
      this.availableNotes.forEach((file) => {
        uniqueFiles.set(file.basename, file);
      });
      return Array.from(uniqueFiles.values());
    }
    return this.availableNotes;
  }

  getItemText(file: TFile): string {
    const isActive = file.path === this.activeNote?.path;
    return this.formatNoteTitle(file.basename, isActive, file.extension);
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onFileSelect(file);
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement) {
    const suggestionEl = el.createDiv({ cls: "pointer-events-none" });

    if (match.item instanceof TFile) {
      const titleEl = suggestionEl.createDiv();
      const file = match.item;
      titleEl.setText(
        this.formatNoteTitle(file.basename, file === this.activeNote, file.extension)
      );
      if (!this.titleOnly) {
        const pathEl = suggestionEl.createDiv({ cls: "mt-1 text-muted text-xs" });
        pathEl.setText(file.path);
      }
    }
  }

  // Override the formatNoteTitle to show all file extensions properly
  protected formatNoteTitle(basename: string, isActive: boolean, extension?: string): string {
    let title = basename;
    if (isActive) {
      title += " (current)";
    }
    if (extension) {
      title += ` (${extension.toUpperCase()})`;
    }
    return title;
  }
}
