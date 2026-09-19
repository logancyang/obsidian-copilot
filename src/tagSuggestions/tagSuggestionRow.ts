import {
  AUTO_ADD_MAX,
  AUTO_ADD_MIN_NOUL,
  type RankedTagSuggestion,
} from "@/tagSuggestions/tagSuggestions";
import { App, Component, EventRef, getAllTags, MarkdownView, Notice, TFile } from "obsidian";

const VISIBLE_SUGGESTIONS = 5;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const CACHE_MAX_NOTES = 50;

export type AddSuggestedTags = (tags: string[]) => Promise<boolean>;

interface CachedSuggestions {
  expiresAt: number;
  ranked: ReadonlyArray<RankedTagSuggestion>;
}

interface TagSuggestionSession {
  file: TFile;
  view?: MarkdownView;
  ranked: ReadonlyArray<RankedTagSuggestion>;
  addTags?: AddSuggestedTags;
  pendingTags: Set<string>;
  loading: boolean;
  quiet: boolean;
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

/** Owns the in-view tag suggestion UI and its per-note runtime state. */
export class TagSuggestionRow extends Component {
  private session?: TagSuggestionSession;
  private requestGeneration = 0;
  private readonly inFlight = new Map<string, number>();
  private readonly cache = new Map<string, CachedSuggestions>();

  constructor(private readonly app: App) {
    super();
  }

  /** Invalidates older runs and records a request for the given note. */
  beginRequest(file: TFile): number {
    if (this.session) this.closeSession(this.session);
    const generation = ++this.requestGeneration;
    this.inFlight.set(file.path, generation);
    return generation;
  }

  /** Reports whether an asynchronous run may still publish its result. */
  isCurrentRequest(generation: number): boolean {
    return generation === this.requestGeneration;
  }

  /** Finishes the matching run and removes its placeholder if no result replaced it. */
  finishRequest(file: TFile, generation: number): void {
    if (this.inFlight.get(file.path) !== generation) return;
    this.inFlight.delete(file.path);
    if (
      this.requestGeneration === generation &&
      this.session?.file.path === file.path &&
      this.session.loading
    ) {
      this.closeSession(this.session);
    }
  }

  isRequestInFlight(file: TFile): boolean {
    return this.inFlight.has(file.path);
  }

  hasSession(file: TFile): boolean {
    return this.session?.file.path === file.path;
  }

  cacheSuggestions(file: TFile, suggestions: RankedTagSuggestion[], now = Date.now()): void {
    this.cache.delete(file.path);
    this.cache.set(file.path, {
      expiresAt: now + CACHE_TTL_MS,
      ranked: Object.freeze([...suggestions]),
    });
    while (this.cache.size > CACHE_MAX_NOTES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  getCachedSuggestions(file: TFile, now = Date.now()): RankedTagSuggestion[] | undefined {
    const entry = this.cache.get(file.path);
    if (!entry) return undefined;
    if (entry.expiresAt < now) {
      this.cache.delete(file.path);
      return undefined;
    }
    this.cache.delete(file.path);
    this.cache.set(file.path, entry);
    return [...entry.ranked];
  }

  showLoading(file: TFile, quiet = false, view?: MarkdownView): boolean {
    this.replaceSession(file, [], undefined, true, quiet, view);
    return this.session?.file.path === file.path;
  }

  show(
    file: TFile,
    suggestions: RankedTagSuggestion[],
    addTags: AddSuggestedTags,
    view?: MarkdownView
  ): void {
    if (this.session?.file.path === file.path) {
      if (view) this.session.view = view;
      this.session.ranked = Object.freeze([...suggestions]);
      this.session.addTags = addTags;
      this.session.loading = false;
      this.render(this.session);
      return;
    }
    this.replaceSession(file, suggestions, addTags, false, false, view);
  }

  close(): void {
    this.requestGeneration++;
    this.inFlight.clear();
    if (this.session) this.closeSession(this.session);
  }

  onunload(): void {
    this.close();
    this.cache.clear();
  }

  private replaceSession(
    file: TFile,
    suggestions: RankedTagSuggestion[],
    addTags: AddSuggestedTags | undefined,
    loading: boolean,
    quiet: boolean,
    view?: MarkdownView
  ): void {
    if (this.session) this.closeSession(this.session);
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
        this.close();
      }
    };
    const workspaceRef = this.app.workspace.on("active-leaf-change", closeIfSourceIsInactive);
    const fileOpenRef = this.app.workspace.on("file-open", closeIfSourceIsInactive);
    const layoutRef = this.app.workspace.on("layout-change", () => this.render(session));
    session = {
      file,
      view: view ?? this.findView(file),
      ranked: Object.freeze([...suggestions]),
      addTags,
      pendingTags: new Set<string>(),
      loading,
      quiet,
      metadataRef,
      workspaceRef,
      fileOpenRef,
      layoutRef,
    };
    this.session = session;
    this.render(session);
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
      this.close();
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
      if (!session.quiet) new Notice("Couldn’t show tag suggestions in this note.");
      this.close();
      return;
    }

    const cache = this.app.metadataCache.getFileCache(session.file);
    const existing = new Set((cache ? (getAllTags(cache) ?? []) : []).map(normalizedTag));
    const available = session.ranked.filter(({ tag }) => {
      const normalized = normalizedTag(tag);
      return !existing.has(normalized) && !session.pendingTags.has(normalized);
    });
    if (!session.loading && !available.length) return;

    const row = container.doc.win.createDiv({
      cls: "metadata-property copilot-tag-suggestion-row",
    });
    const hiddenAnchor = hiddenMountAnchor(container, modeRoot);
    if (hiddenAnchor) {
      hiddenAnchor.after(row);
    } else {
      const properties = Array.from(container.querySelectorAll<HTMLElement>(".metadata-property"));
      const tagsProperty = container.querySelector<HTMLElement>(
        '.metadata-property[data-property-key="tags"]'
      );
      if (tagsProperty) tagsProperty.before(row);
      else if (properties.at(-1)) properties.at(-1)?.after(row);
      else container.appendChild(row);
    }

    if (session.loading) {
      row.createSpan({
        cls: ["multi-select-pill", "copilot-tag-suggestion-placeholder"],
        text: "Suggesting tags…",
      });
    } else {
      const autoAdd = available
        .filter(({ score }) => score >= AUTO_ADD_MIN_NOUL)
        .slice(0, AUTO_ADD_MAX);
      if (autoAdd.length) {
        const count = autoAdd.length;
        row
          .createEl("button", {
            cls: ["multi-select-pill", "copilot-tag-auto-add-pill"],
            text: `Auto-add ${count}`,
            attr: { type: "button", "aria-label": `Auto-add ${count} tags` },
          })
          .addEventListener("click", () => {
            void this.choose(
              session,
              autoAdd.map(({ tag }) => tag)
            );
          });
      }

      for (const suggestion of available.slice(0, VISIBLE_SUGGESTIONS)) {
        const pill = row.createEl("button", {
          cls: ["multi-select-pill", "copilot-tag-suggestion-pill"],
          text: `#${suggestion.tag}`,
          attr: { type: "button", "aria-label": `Add #${suggestion.tag}` },
        });
        pill.addEventListener("click", () => {
          void this.choose(session, [suggestion.tag]);
        });
      }
    }
    row
      .createEl("button", {
        cls: ["clickable-icon", "copilot-tag-suggestion-close"],
        text: "×",
        attr: { type: "button", "aria-label": "Close tag suggestions" },
      })
      .addEventListener("click", () => this.close());
    session.rowEl = row;
  }

  private async choose(session: TagSuggestionSession, tags: string[]): Promise<void> {
    if (this.session !== session || !session.addTags) return;
    const normalized = tags.map(normalizedTag);
    if (normalized.some((tag) => session.pendingTags.has(tag))) return;
    normalized.forEach((tag) => session.pendingTags.add(tag));
    this.render(session);
    try {
      await session.addTags(tags);
    } finally {
      normalized.forEach((tag) => session.pendingTags.delete(tag));
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
