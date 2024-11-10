import { App } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";

export class NoteTitleModal extends BaseNoteModal<string> {
  private onChooseNoteTitle: (noteTitle: string) => void;

  constructor(app: App, noteTitles: string[], onChooseNoteTitle: (noteTitle: string) => void) {
    super(app);
    this.onChooseNoteTitle = onChooseNoteTitle;
    this.availableNotes = this.getOrderedNotes().map((file) => file.basename);
  }

  getItems(): string[] {
    return this.availableNotes;
  }

  getItemText(noteTitle: string): string {
    const isActive = noteTitle === this.activeNote?.basename;
    return this.formatNoteTitle(noteTitle, isActive);
  }

  onChooseItem(noteTitle: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseNoteTitle(noteTitle);
  }
}
