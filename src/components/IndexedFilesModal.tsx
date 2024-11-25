import { App, TFile } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";

export class IndexedFilesModal extends BaseNoteModal<string> {
  constructor(
    app: App,
    private indexedFiles: string[]
  ) {
    super(app);
    this.availableNotes = indexedFiles;
  }

  getItems(): string[] {
    return this.availableNotes;
  }

  getItemText(filePath: string): string {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file) return filePath;

    const isActive = filePath === this.activeNote?.path;
    if (file instanceof TFile) {
      return this.formatNoteTitle(file.basename, isActive, file.extension);
    }
    return this.formatNoteTitle(file.name, isActive);
  }

  onChooseItem(filePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      this.app.workspace.getLeaf().openFile(file as TFile);
    }
  }
}
