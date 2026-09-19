import { TagSuggestionModal } from "@/components/modals/TagSuggestionModal";
import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, Component, EventRef, getAllTags, MarkdownView, TFile } from "obsidian";

const VISIBLE_SUGGESTIONS = 5;

export type AddSuggestedTag = (tag: string) => Promise<boolean>;

interface TagSuggestionSession {
  file: TFile;
  view?: MarkdownView;
  queue: RankedTagSuggestion[];
  addTag: AddSuggestedTag;
  pendingWrites: number;
  rowEl?: HTMLElement;
  modal?: TagSuggestionModal;
  fallbackOpened: boolean;
  metadataRef: EventRef;
  workspaceRef: EventRef;
}

function normalizedTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

function isVisible(container: HTMLElement): boolean {
  if (
    container.hidden ||
    container.getAttribute("aria-hidden") === "true" ||
    container.closest(".is-hidden, .is-collapsed")
  ) {
    return false;
  }
  const style = container.doc.defaultView?.getComputedStyle(container);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

/** Owns the in-view tag suggestion UI and its per-note lifecycle. */
export class TagSuggestionRow extends Component {
  private session?: TagSuggestionSession;

  constructor(private readonly app: App) {
    super();
  }

  show(file: TFile, suggestions: RankedTagSuggestion[], addTag: AddSuggestedTag): void {
    this.close();
    const session = {
      file,
      view: this.findView(file),
      queue: suggestions.slice(0, 10),
      addTag,
      pendingWrites: 0,
      fallbackOpened: false,
    } as TagSuggestionSession;
    session.metadataRef = this.app.metadataCache.on("changed", (changedFile) => {
      if (changedFile.path === session.file.path) this.render(session);
    });
    session.workspaceRef = this.app.workspace.on("active-leaf-change", () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (
        !activeView ||
        activeView !== session.view ||
        activeView.file?.path !== session.file.path
      ) {
        this.closeSession(session);
      }
    });
    this.session = session;
    this.render(session);
  }

  close(): void {
    if (this.session) this.closeSession(this.session);
  }

  onunload(): void {
    this.close();
  }

  private findView(file: TFile): MarkdownView | undefined {
    const activeView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
    if (activeView?.file?.path === file.path) return activeView;
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view as MarkdownView)
      .find((view) => view.file?.path === file.path);
  }

  private viewStillShowsFile(view: MarkdownView, file: TFile): boolean {
    return (
      view.file?.path === file.path &&
      this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view)
    );
  }

  private render(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    if (session.view && !this.viewStillShowsFile(session.view, session.file)) {
      this.closeSession(session);
      return;
    }
    session.view ??= this.findView(session.file);

    const cache = this.app.metadataCache.getFileCache(session.file);
    const existing = new Set((cache ? (getAllTags(cache) ?? []) : []).map(normalizedTag));
    session.queue = session.queue.filter(({ tag }) => !existing.has(normalizedTag(tag)));
    if (!session.queue.length && session.pendingWrites === 0) {
      this.closeSession(session);
      return;
    }

    session.rowEl?.remove();
    session.rowEl = undefined;
    const container = session.view?.contentEl.querySelector<HTMLElement>(".metadata-container");
    if (!container || !isVisible(container)) {
      this.openFallback(session);
      return;
    }

    this.closeModal(session);
    const row = container.createDiv({ cls: "metadata-property copilot-tag-suggestion-row" });
    const properties = Array.from(
      container.querySelectorAll<HTMLElement>(".metadata-property")
    ).filter((property) => property !== row);
    const anchor =
      container.querySelector<HTMLElement>('.metadata-property[data-property-key="tags"]') ??
      properties.at(-1);
    if (anchor) anchor.after(row);

    for (const suggestion of session.queue.slice(0, VISIBLE_SUGGESTIONS)) {
      const pill = row.createEl("button", {
        cls: ["multi-select-pill", "copilot-tag-suggestion-pill"],
        text: `#${suggestion.tag}`,
        attr: { type: "button", "aria-label": `Add #${suggestion.tag}` },
      });
      pill.addEventListener("click", () => {
        void this.choose(session, suggestion);
      });
    }
    row
      .createEl("button", {
        cls: ["clickable-icon", "copilot-tag-suggestion-close"],
        text: "×",
        attr: { type: "button", "aria-label": "Close tag suggestions" },
      })
      .addEventListener("click", () => this.closeSession(session));
    session.rowEl = row;
  }

  private openFallback(session: TagSuggestionSession): void {
    // The Properties DOM is not a public Obsidian API, so the modal remains the
    // safe path when that surface is unavailable.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
    if (session.fallbackOpened || session.pendingWrites > 0 || !session.queue.length) return;
    session.fallbackOpened = true;
    const modal = new TagSuggestionModal(
      this.app,
      session.queue,
      async (tag) => {
        if (this.session !== session || session.modal !== modal) return;
        session.modal = undefined;
        session.fallbackOpened = false;
        const suggestion = session.queue.find(
          (candidate) => normalizedTag(candidate.tag) === normalizedTag(tag)
        );
        if (suggestion) await this.choose(session, suggestion);
      },
      () => {
        if (this.session === session && session.modal === modal) this.closeSession(session);
      }
    );
    session.modal = modal;
    modal.open();
  }

  private async choose(
    session: TagSuggestionSession,
    suggestion: RankedTagSuggestion
  ): Promise<void> {
    if (this.session !== session) return;
    const index = session.queue.indexOf(suggestion);
    if (index < 0) return;
    session.queue.splice(index, 1);
    session.pendingWrites++;
    this.render(session);
    const written = await session.addTag(suggestion.tag);
    session.pendingWrites--;
    if (this.session !== session) return;
    if (!written) {
      // A failed write must not silently consume a suggestion the user can retry.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/492
      this.closeModal(session);
      session.fallbackOpened = false;
      session.queue.splice(Math.min(index, session.queue.length), 0, suggestion);
    }
    this.render(session);
  }

  private closeModal(session: TagSuggestionSession): void {
    const modal = session.modal;
    session.modal = undefined;
    modal?.close();
  }

  private closeSession(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    session.rowEl?.remove();
    this.closeModal(session);
    this.app.metadataCache.offref(session.metadataRef);
    this.app.workspace.offref(session.workspaceRef);
    this.session = undefined;
  }
}
