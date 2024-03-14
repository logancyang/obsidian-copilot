import { App, FuzzySuggestModal } from "obsidian";

export class NoteTitleModal extends FuzzySuggestModal<string> {
  private onChooseNoteTitle: (noteTitle: string) => void;
  private noteTitles: string[];

  constructor(
    app: App,
    noteTitles: string[],
    onChooseNoteTitle: (noteTitle: string) => void
  ) {
    super(app);
    this.noteTitles = noteTitles;
    this.onChooseNoteTitle = onChooseNoteTitle;
  }

  getItems(): string[] {
    return this.noteTitles;
  }

  getItemText(noteTitle: string): string {
    return noteTitle;
  }

  onChooseItem(noteTitle: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseNoteTitle(noteTitle);
  }
}