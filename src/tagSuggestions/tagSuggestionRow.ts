import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, Component, EventRef, getAllTags, MarkdownView, Notice, TFile } from "obsidian";

const VISIBLE_SUGGESTIONS = 5;

export type AddSuggestedTag = (tag: string) => Promise<boolean>;

interface TagSuggestionSession {
  file: TFile;
  view?: MarkdownView;
  ranked: ReadonlyArray<RankedTagSuggestion>;
  addTag: AddSuggestedTag;
  pendingTags: Set<string>;
  rowEl?: HTMLElement;
  metadataRef: EventRef;
  workspaceRef: EventRef;
  fileOpenRef: EventRef;
  layoutRef: EventRef;
}

function normalizedTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

function hiddenMountAnchor(container: HTMLElement, modeRoot: HTMLElement): HTMLElement | undefined {
  let anchor: HTMLElement | undefined;
  for (
    let element: HTMLElement | null = container;
    element && element !== modeRoot;
    element = element.parentElement
  ) {
    if (
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      element.matches(".is-hidden, .is-collapsed")
    ) {
      anchor = element;
    }
    const style = element.doc.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") anchor = element;
  }
  return anchor;
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
    let session: TagSuggestionSession;
    const metadataRef = this.app.metadataCache.on("changed", (changedFile) => {
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
    const workspaceRef = this.app.workspace.on("active-leaf-change", closeIfSourceIsInactive);
    const fileOpenRef = this.app.workspace.on("file-open", closeIfSourceIsInactive);
    const layoutRef = this.app.workspace.on("layout-change", () => this.render(session));
    session = {
      file,
      view: this.findView(file),
      ranked: [...suggestions],
      addTag,
      pendingTags: new Set<string>(),
      metadataRef,
      workspaceRef,
      fileOpenRef,
      layoutRef,
    };
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

    session.rowEl?.remove();
    session.rowEl = undefined;
    const view = session.view;
    const modeRootSelector =
      view?.getMode() === "preview" ? ".markdown-reading-view" : ".markdown-source-view";
    const modeRoot = view?.contentEl.querySelector<HTMLElement>(modeRootSelector);
    const container = modeRoot?.querySelector<HTMLElement>(".metadata-container");
    if (!container || !modeRoot) {
      new Notice("Couldn’t show tag suggestions in this note.");
      this.closeSession(session);
      return;
    }

    const cache = this.app.metadataCache.getFileCache(session.file);
    const existing = new Set((cache ? (getAllTags(cache) ?? []) : []).map(normalizedTag));
    const visible = session.ranked
      .filter(({ tag }) => {
        const normalized = normalizedTag(tag);
        return !existing.has(normalized) && !session.pendingTags.has(normalized);
      })
      .slice(0, VISIBLE_SUGGESTIONS);
    if (!visible.length) return;

    const row = container.doc.win.createDiv({
      cls: "metadata-property copilot-tag-suggestion-row",
    });
    const hiddenAnchor = hiddenMountAnchor(container, modeRoot);
    if (hiddenAnchor) {
      hiddenAnchor.after(row);
    } else {
      const properties = Array.from(container.querySelectorAll<HTMLElement>(".metadata-property"));
      const anchor =
        container.querySelector<HTMLElement>('.metadata-property[data-property-key="tags"]') ??
        properties.at(-1);
      if (anchor) anchor.after(row);
      else container.appendChild(row);
    }

    for (const suggestion of visible) {
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
    const normalized = normalizedTag(suggestion.tag);
    if (session.pendingTags.has(normalized)) return;
    session.pendingTags.add(normalized);
    this.render(session);
    try {
      await session.addTag(suggestion.tag);
    } finally {
      session.pendingTags.delete(normalized);
      if (this.session === session) this.render(session);
    }
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
