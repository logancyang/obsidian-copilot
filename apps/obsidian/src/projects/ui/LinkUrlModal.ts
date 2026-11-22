import { parseUrlsFromText, type UrlItem } from "@/lib/url-tag";
import { App, SuggestModal } from "obsidian";

export class LinkUrlModal extends SuggestModal<UrlItem> {
  constructor(
    app: App,
    private readonly onChoose: (item: UrlItem) => void
  ) {
    super(app);
    this.setPlaceholder("Paste a web page or YouTube link...");
    this.emptyStateText = "Type or paste a link.";
  }

  getSuggestions(query: string): UrlItem[] {
    return parseUrlsFromText(query);
  }

  renderSuggestion(item: UrlItem, el: HTMLElement): void {
    el.setText(item.url);
  }

  onChooseSuggestion(item: UrlItem): void {
    this.onChoose(item);
  }
}
