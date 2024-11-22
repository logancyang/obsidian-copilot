import { App, TFile } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";

interface AddContextNoteModalProps {
  app: App;
  onNoteSelect: (note: TFile) => void;
  excludeNotes: string[];
}

export class AddContextNoteModal extends BaseNoteModal<TFile> {
  private onNoteSelect: (note: TFile) => void;
  private excludeNotes: string[];

  constructor({ app, onNoteSelect, excludeNotes }: AddContextNoteModalProps) {
    super(app);
    this.onNoteSelect = onNoteSelect;
    this.excludeNotes = excludeNotes;
    this.availableNotes = this.getOrderedNotes(excludeNotes);
  }

  getItems(): TFile[] {
    return this.availableNotes;
  }

  getItemText(note: TFile): string {
    const isActive = note.path === this.activeNote?.path;
    return this.formatNoteTitle(note.basename, isActive, note.extension);
  }

  onChooseItem(note: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onNoteSelect(note);
  }
}
