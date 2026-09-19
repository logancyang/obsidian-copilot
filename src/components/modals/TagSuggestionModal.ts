import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, FuzzySuggestModal } from "obsidian";

/** Presents ranked tag choices while delegating all note writes to its callback. */
export class TagSuggestionModal extends FuzzySuggestModal<RankedTagSuggestion> {
  constructor(
    app: App,
    private readonly suggestions: RankedTagSuggestion[],
    private readonly onChooseTag: (tag: string) => void | Promise<void>
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

  onChooseItem(suggestion: RankedTagSuggestion): void {
    void this.onChooseTag(suggestion.tag);
  }
}
