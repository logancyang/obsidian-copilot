import { getSettings } from "@/settings/model";
import {
  suggestTagsForCurrentNote,
  type SuggestTagOptions,
} from "@/tagSuggestions/tagSuggestionCommand";
import type { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { App, Component, MarkdownView, TFile } from "obsidian";

type SuggestTagRunner = (
  app: App,
  row: TagSuggestionRow,
  options: SuggestTagOptions
) => Promise<void>;

/** Routes focus from native tag properties into the shared quiet suggestion pipeline. */
export class TagSuggestionFocusTrigger extends Component {
  private readonly documents = new Set<Document>();

  constructor(
    private readonly app: App,
    private readonly row: TagSuggestionRow,
    private readonly run: SuggestTagRunner = suggestTagsForCurrentNote
  ) {
    super();
  }

  onload(): void {
    this.listen(this.app.workspace.containerEl.doc);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const contentEl = (leaf.view as MarkdownView).contentEl;
      // Obsidian exposes deferred background leaves before creating their DOM.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
      if (contentEl) this.listen(contentEl.doc);
    }
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => this.listen(win.document))
    );
  }

  onunload(): void {
    this.documents.clear();
  }

  private listen(doc: Document): void {
    if (this.documents.has(doc)) return;
    this.documents.add(doc);
    this.registerDomEvent(doc, "focusin", (event) => this.handleFocus(event));
  }

  private handleFocus(event: FocusEvent): void {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== "function") return;
    const property = (target as Element).closest<HTMLElement>(
      '.metadata-property[data-property-key="tags"], .metadata-property[data-property-key="tag"]'
    );
    if (!property) return;
    if (this.row.isNativeFocusSuppressed(property)) return;
    const view = this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view as MarkdownView)
      // A different background leaf can still be deferred when focus reaches a loaded view.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
      .find((candidate) => candidate.contentEl?.contains(property));
    if (!(view?.file instanceof TFile) || view.file.extension !== "md") return;

    // The shared quiet pipeline owns entitlement and duplicate-run guards.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
    if (!getSettings().suggestTagsOnPropertyFocus) return;
    void this.run(this.app, this.row, { quiet: true, view });
  }
}
