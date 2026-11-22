import { App, FuzzySuggestModal, TFile } from "obsidian";

export abstract class BaseNoteModal<T> extends FuzzySuggestModal<T> {
  protected activeNote: TFile | null;
  protected availableNotes: T[];

  constructor(app: App) {
    super(app);
    this.activeNote = app.workspace.getActiveFile();
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
