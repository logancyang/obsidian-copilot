import { App, FuzzyMatch, TFile } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";

interface AddContextNoteModalProps {
  app: App;
  onNoteSelect: (note: TFile) => void;
  excludeNotePaths: string[];
  titleOnly?: boolean;
}

export class AddContextNoteModal extends BaseNoteModal<TFile> {
  private onNoteSelect: (note: TFile) => void;
  private titleOnly: boolean;

  constructor({
    app,
    onNoteSelect,
    excludeNotePaths,
    titleOnly = false,
  }: AddContextNoteModalProps) {
    super(app);
    this.onNoteSelect = onNoteSelect;
    this.availableNotes = this.getOrderedNotes(excludeNotePaths);
    this.titleOnly = titleOnly;
  }

  getItems(): TFile[] {
    if (this.titleOnly) {
      // Deduplicate notes by basename
      const uniqueNotes = new Map<string, TFile>();
      this.availableNotes.forEach((note) => {
        uniqueNotes.set(note.basename, note);
      });
      return Array.from(uniqueNotes.values());
    }
    return this.availableNotes;
  }

  getItemText(note: TFile): string {
    const isActive = note.path === this.activeNote?.path;
    return this.formatNoteTitle(note.basename, isActive, note.extension);
  }

  onChooseItem(note: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onNoteSelect(note);
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
}
