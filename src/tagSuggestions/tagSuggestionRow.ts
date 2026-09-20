import { frontmatterTags, type RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { App, Component, EventRef, MarkdownView, setIcon, TFile } from "obsidian";

const VISIBLE_SUGGESTIONS = 2;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const CACHE_MAX_NOTES = 50;
const TAG_PROPERTY_SELECTOR =
  '.metadata-property[data-property-key="tags"], .metadata-property[data-property-key="tag"]';

export type UpdateSuggestedTags = (add: string[], remove: string[]) => Promise<boolean>;

interface CachedSuggestions {
  expiresAt: number;
  ranked: ReadonlyArray<RankedTagSuggestion>;
}

interface TagSuggestionSession {
  file: TFile;
  view: MarkdownView;
  nativeRow: HTMLElement;
  ranked: ReadonlyArray<RankedTagSuggestion>;
  updateTags?: UpdateSuggestedTags;
  pendingTags: Set<string>;
  loading: boolean;
  rowEl: HTMLElement;
  pillsEl: HTMLElement;
  metadataRef: EventRef;
  workspaceRef: EventRef;
  fileOpenRef: EventRef;
  layoutRef: EventRef;
}

function normalizedTag(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase();
}

function isVisible(element: HTMLElement, boundary: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      current.matches(".is-hidden, .is-collapsed")
    ) {
      return false;
    }
    const style = current.doc.defaultView?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    if (current === boundary) return true;
  }
  return false;
}

/** Owns the focused, native-looking tags row and its per-note runtime state. */
export class TagSuggestionRow extends Component {
  private session?: TagSuggestionSession;
  private suppressedNativeRow?: HTMLElement;
  private clearSuppression?: () => void;
  private requestGeneration = 0;
  private readonly inFlight = new Map<string, number>();
  private readonly cache = new Map<string, CachedSuggestions>();

  constructor(private readonly app: App) {
    super();
  }

  beginRequest(file: TFile): number {
    if (this.session) this.closeSession(this.session);
    const generation = ++this.requestGeneration;
    this.inFlight.set(file.path, generation);
    return generation;
  }

  isCurrentRequest(generation: number): boolean {
    return generation === this.requestGeneration;
  }

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

  isNativeFocusSuppressed(property: HTMLElement): boolean {
    return this.suppressedNativeRow === property;
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

  showLoading(file: TFile, view?: MarkdownView): boolean {
    return this.replaceSession(file, [], undefined, true, view);
  }

  show(
    file: TFile,
    suggestions: RankedTagSuggestion[],
    updateTags: UpdateSuggestedTags,
    view?: MarkdownView
  ): void {
    if (this.session?.file.path === file.path && (!view || this.session.view === view)) {
      this.session.ranked = Object.freeze([...suggestions]);
      this.session.updateTags = updateTags;
      this.session.loading = false;
      this.render(this.session);
      return;
    }
    this.replaceSession(file, suggestions, updateTags, false, view);
  }

  close(): void {
    this.requestGeneration++;
    this.inFlight.clear();
    if (this.session) this.closeSession(this.session);
  }

  onunload(): void {
    this.close();
    this.clearNativeSuppression();
    this.cache.clear();
  }

  private replaceSession(
    file: TFile,
    suggestions: RankedTagSuggestion[],
    updateTags: UpdateSuggestedTags | undefined,
    loading: boolean,
    suppliedView?: MarkdownView
  ): boolean {
    if (this.session) this.closeSession(this.session);
    const view = suppliedView ?? this.findView(file);
    const nativeRow = view ? this.findNativeRow(view) : undefined;
    if (!view || !nativeRow) return false;

    const rowEl = nativeRow.ownerDocument.win.createDiv({
      cls: "metadata-property copilot-tag-suggestion-row",
      attr: { tabindex: "-1" },
    });
    const key = rowEl.createDiv({ cls: "metadata-property-key" });
    const icon = key.createSpan({ cls: "metadata-property-icon" });
    setIcon(icon, "tags");
    key.createEl("input", {
      cls: "metadata-property-key-input",
      attr: {
        type: "text",
        value: nativeRow.dataset.propertyKey ?? "tags",
        readonly: "",
        tabindex: "-1",
        "aria-label": nativeRow.dataset.propertyKey ?? "tags",
      },
    });
    const value = rowEl.createDiv({
      cls: "metadata-property-value",
      attr: { "data-property-type": "tags" },
    });
    const pillsEl = value.createDiv({ cls: "multi-select-container" });
    nativeRow.before(rowEl);

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
      view,
      nativeRow,
      ranked: Object.freeze([...suggestions]),
      updateTags,
      pendingTags: new Set<string>(),
      loading,
      rowEl,
      pillsEl,
      metadataRef,
      workspaceRef,
      fileOpenRef,
      layoutRef,
    };
    this.session = session;

    rowEl.addEventListener("focusout", (event) => {
      if (this.session !== session || rowEl.contains(event.relatedTarget as Node | null)) return;
      // Obsidian replaces the Properties DOM during a frontmatter write. The
      // focused row is briefly detached with no related target before the
      // metadata callback puts the same row back.
      if (session.pendingTags.size && event.relatedTarget === null) return;
      this.closeSession(session);
    });
    rowEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeSession(session);
        return;
      }
      const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (printable || event.key === "Backspace") this.handBackToNative(session);
    });
    rowEl.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (!target.closest(".multi-select-pill")) this.handBackToNative(session);
    });

    this.render(session);
    rowEl.focus();
    return true;
  }

  private findView(file: TFile): MarkdownView | undefined {
    const activeView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
    if (activeView?.file?.path === file.path) return activeView;
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view as MarkdownView)
      .find((view) => view.file?.path === file.path);
  }

  private findNativeRow(view: MarkdownView): HTMLElement | undefined {
    const selector =
      view.getMode() === "preview" ? ".markdown-reading-view" : ".markdown-source-view";
    const modeRoot = view.contentEl.querySelector<HTMLElement>(selector);
    const row = modeRoot?.querySelector<HTMLElement>(TAG_PROPERTY_SELECTOR);
    const visibilityRoot = row?.previousElementSibling?.classList.contains(
      "copilot-tag-suggestion-row"
    )
      ? row.parentElement
      : row;
    return modeRoot && row && visibilityRoot && isVisible(visibilityRoot, modeRoot)
      ? row
      : undefined;
  }

  private viewStillShowsFile(view: MarkdownView, file: TFile): boolean {
    return (
      view.file?.path === file.path &&
      this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view)
    );
  }

  private render(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    if (!this.viewStillShowsFile(session.view, session.file)) {
      this.close();
      return;
    }
    const nativeRow = this.findNativeRow(session.view);
    if (!nativeRow) {
      this.closeSession(session);
      return;
    }
    session.nativeRow = nativeRow;
    const wasConnected = session.rowEl.isConnected;
    if (session.rowEl.nextElementSibling !== nativeRow) nativeRow.before(session.rowEl);
    if (!wasConnected && session.pendingTags.size) session.rowEl.focus();

    if (session.pillsEl.contains(session.rowEl.doc.activeElement)) session.rowEl.focus();
    session.pillsEl.replaceChildren();
    if (session.loading) {
      const placeholder = session.pillsEl.createSpan({
        cls: ["multi-select-pill", "copilot-tag-suggestion-placeholder"],
      });
      placeholder.createSpan({ cls: "multi-select-pill-content", text: "Suggesting…" });
      return;
    }

    const cache = this.app.metadataCache.getFileCache(session.file);
    const existingTags = frontmatterTags(cache);
    const existing = new Set(existingTags.map(normalizedTag));
    for (const tag of existingTags) {
      const normalized = normalizedTag(tag);
      if (!normalized || session.pendingTags.has(normalized)) continue;
      const pill = session.pillsEl.createDiv({
        cls: "multi-select-pill",
        attr: { tabindex: "0" },
      });
      const content = pill.createDiv({ cls: "multi-select-pill-content" });
      content.createSpan({ text: tag.replace(/^#/, "") });
      const remove = pill.createDiv({
        cls: "multi-select-pill-remove-button",
        attr: { role: "button", "aria-label": `Remove #${tag.replace(/^#/, "")}` },
      });
      setIcon(remove, "x");
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.changeTags(session, [], [tag]);
      });
    }

    const available = session.ranked.filter(({ tag }) => {
      const normalized = normalizedTag(tag);
      return !existing.has(normalized) && !session.pendingTags.has(normalized);
    });
    for (const suggestion of available.slice(0, VISIBLE_SUGGESTIONS)) {
      const pill = session.pillsEl.createEl("button", {
        cls: ["multi-select-pill", "copilot-tag-suggestion-pill"],
        attr: { type: "button", "aria-label": `Add #${suggestion.tag}` },
      });
      pill.createSpan({ cls: "multi-select-pill-content", text: `#${suggestion.tag}` });
      pill.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.changeTags(session, [suggestion.tag], []);
      });
    }
  }

  private async changeTags(
    session: TagSuggestionSession,
    add: string[],
    remove: string[]
  ): Promise<void> {
    if (this.session !== session || !session.updateTags) return;
    const normalized = [...add, ...remove].map(normalizedTag);
    if (normalized.some((tag) => session.pendingTags.has(tag))) return;
    normalized.forEach((tag) => session.pendingTags.add(tag));
    this.render(session);
    try {
      await session.updateTags(add, remove);
    } finally {
      // processFrontMatter can resolve before Obsidian's Properties redraw.
      // Keep the pending guard through that render frame so its transient
      // focusout cannot close the session.
      await new Promise<void>((resolve) => session.rowEl.win.setTimeout(resolve, 50));
      normalized.forEach((tag) => session.pendingTags.delete(tag));
      if (this.session === session) this.render(session);
    }
  }

  private handBackToNative(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    const nativeRow = session.nativeRow;
    const input = nativeRow.querySelector<HTMLElement>(
      '.multi-select-input[contenteditable="true"], .multi-select-input, [contenteditable="true"]'
    );
    if (!input) {
      this.closeSession(session);
      return;
    }
    this.suppressNativeFocus(nativeRow);
    this.closeSession(session);
    input.focus();
  }

  private suppressNativeFocus(nativeRow: HTMLElement): void {
    this.clearNativeSuppression();
    this.suppressedNativeRow = nativeRow;
    const onFocusOut = (event: FocusEvent) => {
      if (!nativeRow.contains(event.relatedTarget as Node | null)) this.clearNativeSuppression();
    };
    nativeRow.addEventListener("focusout", onFocusOut);
    this.clearSuppression = () => nativeRow.removeEventListener("focusout", onFocusOut);
  }

  private clearNativeSuppression(): void {
    this.clearSuppression?.();
    this.clearSuppression = undefined;
    this.suppressedNativeRow = undefined;
  }

  private closeSession(session: TagSuggestionSession): void {
    if (this.session !== session) return;
    // Removing the focused row can synchronously dispatch focusout. Clear the
    // session first so that handler cannot re-enter closeSession.
    this.session = undefined;
    session.rowEl.remove();
    this.app.metadataCache.offref(session.metadataRef);
    this.app.workspace.offref(session.workspaceRef);
    this.app.workspace.offref(session.fileOpenRef);
    this.app.workspace.offref(session.layoutRef);
  }
}
