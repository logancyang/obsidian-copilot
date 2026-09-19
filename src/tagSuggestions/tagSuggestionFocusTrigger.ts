import { isPlusEnabled } from "@/plusUtils";
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
      this.listen((leaf.view as MarkdownView).contentEl.doc);
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
      '.metadata-property[data-property-key="tags"]'
    );
    if (!property) return;
    const view = this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view as MarkdownView)
      .find((candidate) => candidate.contentEl.contains(property));
    const file = view?.file;
    if (!(file instanceof TFile) || file.extension !== "md") return;

    // Focus is intentionally silent and must never turn into a license request or duplicate run.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
    if (
      !getSettings().suggestTagsOnPropertyFocus ||
      !isPlusEnabled() ||
      this.row.hasSession(file) ||
      this.row.isRequestInFlight(file)
    ) {
      return;
    }
    void this.run(this.app, this.row, { quiet: true, view });
  }
}
