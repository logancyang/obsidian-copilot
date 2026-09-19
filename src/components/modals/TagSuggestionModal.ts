import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";

/** Presents ranked tag choices while delegating all note writes to its callback. */
export class TagSuggestionModal extends FuzzySuggestModal<RankedTagSuggestion> {
  private choseSuggestion = false;

  constructor(
    app: App,
    private readonly suggestions: RankedTagSuggestion[],
    private readonly onChooseTag: (tag: string) => void | Promise<void>,
    private readonly onDismiss: () => void
  ) {
    super(app);
    this.setPlaceholder("Select a suggested tag");
  }

  getItems(): RankedTagSuggestion[] {
    return this.suggestions;
  }

  getItemText(suggestion: RankedTagSuggestion): string {
    return `#${suggestion.tag}`;
  }

  selectSuggestion(value: FuzzyMatch<RankedTagSuggestion>, evt: MouseEvent | KeyboardEvent): void {
    this.choseSuggestion = true;
    super.selectSuggestion(value, evt);
  }

  onChooseItem(suggestion: RankedTagSuggestion): void {
    this.choseSuggestion = true;
    void this.onChooseTag(suggestion.tag);
  }

  onClose(): void {
    if (!this.choseSuggestion) this.onDismiss();
  }
}
