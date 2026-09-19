import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, Component, EventRef, getAllTags, MarkdownView, Notice, TFile } from "obsidian";

const VISIBLE_SUGGESTIONS = 5;

export type AddSuggestedTag = (tag: string) => Promise<boolean>;

interface TagSuggestionSession {
  file: TFile;
  view?: MarkdownView;
  queue: RankedTagSuggestion[];
  addTag: AddSuggestedTag;
  pendingWrites: number;
  rowEl?: HTMLElement;
  metadataRef: EventRef;
  workspaceRef: EventRef;
  fileOpenRef: EventRef;
  layoutRef: EventRef;
}

function normalizedTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

function isVisible(container: HTMLElement, viewContent: HTMLElement): boolean {
  for (let element: HTMLElement | null = container; element; element = element.parentElement) {
    if (
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      element.matches(".is-hidden, .is-collapsed")
    ) {
      return false;
    }
    const style = element.doc.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    if (element === viewContent) break;
  }
  return true;
}

/** Owns the in-view tag suggestion UI and its per-note lifecycle. */
export class TagSuggestionRow extends Component {
  private session?: TagSuggestionSession;
  private requestGeneration = 0;

  constructor(private readonly app: App) {
    super();
  }

  /** Invalidates older command runs and returns the new run's generation. */
  beginRequest(): number {
    this.close();
    return ++this.requestGeneration;
  }

  /** Reports whether an asynchronous command run may still publish its result. */
  isCurrentRequest(generation: number): boolean {
    return generation === this.requestGeneration;
  }

  show(file: TFile, suggestions: RankedTagSuggestion[], addTag: AddSuggestedTag): void {
    this.close();
    const session = {
      file,
      view: this.findView(file),
      queue: suggestions,
      addTag,
      pendingWrites: 0,
    } as TagSuggestionSession;
    session.metadataRef = this.app.metadataCache.on("changed", (changedFile) => {
      if (changedFile.path === session.file.path) this.render(session);
    });
    const closeIfSourceIsInactive = () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (
        !activeView ||
        activeView !== session.view ||
        activeView.file?.path !== session.file.path
      ) {
        this.closeSession(session);
      }
    };
    session.workspaceRef = this.app.workspace.on("active-leaf-change", closeIfSourceIsInactive);
    session.fileOpenRef = this.app.workspace.on("file-open", closeIfSourceIsInactive);
    session.layoutRef = this.app.workspace.on("layout-change", () => this.render(session));
    this.session = session;
    this.render(session);
  }

  close(): void {
    if (this.session) this.closeSession(this.session);
  }

  onunload(): void {
    this.requestGeneration++;
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
    const filteredQueue = session.queue.filter(({ tag }) => !existing.has(normalizedTag(tag)));
    session.queue = filteredQueue;
    if (!session.queue.length && session.pendingWrites === 0) {
      this.closeSession(session);
      return;
    }

    session.rowEl?.remove();
    session.rowEl = undefined;
    const view = session.view;
    const modeRootSelector =
      view?.getMode() === "preview" ? ".markdown-reading-view" : ".markdown-source-view";
    const container = view?.contentEl
      .querySelector<HTMLElement>(modeRootSelector)
      ?.querySelector<HTMLElement>(".metadata-container");
    if (!container || !view) {
      new Notice("Couldn’t show tag suggestions in this note.");
      this.closeSession(session);
      return;
    }

    const row = container.createDiv({ cls: "metadata-property copilot-tag-suggestion-row" });
    if (isVisible(container, view.contentEl)) {
      const properties = Array.from(
        container.querySelectorAll<HTMLElement>(".metadata-property")
      ).filter((property) => property !== row);
      const anchor =
        container.querySelector<HTMLElement>('.metadata-property[data-property-key="tags"]') ??
        properties.at(-1);
      if (anchor) anchor.after(row);
    } else {
      container.after(row);
    }

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
      session.queue.splice(Math.min(index, session.queue.length), 0, suggestion);
    }
    this.render(session);
  }

  private closeSession(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    session.rowEl?.remove();
    this.app.metadataCache.offref(session.metadataRef);
    this.app.workspace.offref(session.workspaceRef);
    this.app.workspace.offref(session.fileOpenRef);
    this.app.workspace.offref(session.layoutRef);
    this.session = undefined;
  }
}
