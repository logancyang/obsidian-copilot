import { App, FuzzyMatch, TFile } from "obsidian";
import { BaseNoteModal } from "./BaseNoteModal";
import { ChainType } from "@/chainFactory";

interface AddNoteModalProps {
  app: App;
  onNoteSelect: (notePath: string) => void;
  excludeNotePaths: string[];
}

/**
 * Modal for selecting a note to add to a project.
 * Uses Obsidian's native FuzzySuggestModal for fast vault browsing.
 */
export class AddNoteModal extends BaseNoteModal<TFile> {
  private onNoteSelect: (notePath: string) => void;

  constructor({ app, onNoteSelect, excludeNotePaths }: AddNoteModalProps) {
    super(app, ChainType.COPILOT_PLUS_CHAIN);
    this.onNoteSelect = onNoteSelect;
    this.availableNotes = this.getOrderedNotes(excludeNotePaths);
  }

  getItems(): TFile[] {
    return this.availableNotes;
  }

  getItemText(note: TFile): string {
    const isActive = note.path === this.activeNote?.path;
    return this.formatNoteTitle(note.basename, isActive, note.extension);
  }

  onChooseItem(note: TFile): void {
    this.onNoteSelect(note.path);
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const suggestionEl = el.createDiv({ cls: "pointer-events-none" });

    if (match.item instanceof TFile) {
      const file = match.item;
      const titleEl = suggestionEl.createDiv();
      titleEl.setText(
        this.formatNoteTitle(file.basename, file === this.activeNote, file.extension)
      );
      const pathEl = suggestionEl.createDiv({ cls: "mt-1 text-muted text-xs" });
      pathEl.setText(file.path);
    }
  }
}
