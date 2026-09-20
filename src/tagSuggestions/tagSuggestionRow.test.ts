import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { App, CachedMetadata, EventRef, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";

interface TestContext {
  app: App;
  file: TFile;
  view: MarkdownView;
  sourceContainer: HTMLElement;
  readingContainer: HTMLElement;
  nativeRow: HTMLElement;
  nativeInput: HTMLElement;
  outside: HTMLButtonElement;
  setFrontmatter(value: Record<string, unknown>): void;
  setMode(mode: "source" | "preview"): void;
  replaceNativeRow(key?: "tags" | "tag"): HTMLElement;
  emitMetadataChanged(): void;
  emitActiveLeafChange(): void;
  emitLayoutChange(): void;
  metadataOffRef: jest.Mock;
  workspaceOffRef: jest.Mock;
}

function file(path: string): TFile {
  const TFileConstructor = ObsidianTFile as unknown as new (path: string) => TFile;
  return new TFileConstructor(path);
}

function suggestions(count = 10): RankedTagSuggestion[] {
  return Array.from({ length: count }, (_, index) => ({
    tag: `tag-${index + 1}`,
    score: 1 - index / 10,
  }));
}

function createNativeRow(container: HTMLElement, key: "tags" | "tag" = "tags"): HTMLElement {
  const row = container.createDiv({
    cls: "metadata-property",
    attr: { "data-property-key": key, tabindex: "0" },
  });
  const propertyKey = row.createDiv({ cls: "metadata-property-key" });
  propertyKey.createSpan({ cls: "metadata-property-icon" });
  propertyKey.createEl("input", { cls: "metadata-property-key-input", attr: { value: key } });
  const value = row.createDiv({
    cls: "metadata-property-value",
    attr: { "data-property-type": "tags" },
  });
  const pills = value.createDiv({ cls: "multi-select-container", attr: { tabindex: "-1" } });
  pills.createDiv({
    cls: "multi-select-input",
    attr: { contenteditable: "true", tabindex: "0" },
  });
  return row;
}

function context(options: { key?: "tags" | "tag"; withProperty?: boolean } = {}): TestContext {
  const activeFile = file("Projects/Active.md");
  const contentEl = document.createElement("div");
  const sourceRoot = contentEl.createDiv({ cls: "markdown-source-view" });
  const readingRoot = contentEl.createDiv({ cls: "markdown-reading-view" });
  const sourceContainer = sourceRoot.createDiv({ cls: "metadata-container" });
  const readingContainer = readingRoot.createDiv({ cls: "metadata-container" });
  let mode: "source" | "preview" = "source";
  let frontmatter: Record<string, unknown> = { [options.key ?? "tags"]: ["existing"] };
  let nativeRow =
    options.withProperty === false
      ? sourceContainer.createDiv({
          cls: "metadata-property",
          attr: { "data-property-key": "owner" },
        })
      : createNativeRow(sourceContainer, options.key);
  createNativeRow(readingContainer, options.key);
  const outside = contentEl.createEl("button", { text: "Outside" });
  document.body.appendChild(contentEl);

  const view = {
    file: activeFile,
    contentEl,
    getMode: jest.fn(() => mode),
  } as unknown as MarkdownView;
  const leaf = { view } as unknown as WorkspaceLeaf;
  const metadataListeners = new Set<(changed: TFile) => void>();
  const activeLeafListeners = new Set<() => void>();
  const fileOpenListeners = new Set<() => void>();
  const layoutListeners = new Set<() => void>();
  const metadataOffRef = jest.fn((ref: EventRef) => {
    metadataListeners.delete((ref as unknown as { callback: (changed: TFile) => void }).callback);
  });
  const workspaceOffRef = jest.fn((ref: EventRef) => {
    const callback = (ref as unknown as { callback: () => void }).callback;
    activeLeafListeners.delete(callback);
    fileOpenListeners.delete(callback);
    layoutListeners.delete(callback);
  });
  const app = {
    workspace: {
      getActiveViewOfType: jest.fn(() => view),
      getLeavesOfType: jest.fn(() => [leaf]),
      on: jest.fn((event: string, callback: () => void) => {
        const listeners =
          event === "file-open"
            ? fileOpenListeners
            : event === "layout-change"
              ? layoutListeners
              : activeLeafListeners;
        listeners.add(callback);
        return { callback };
      }),
      offref: workspaceOffRef,
    },
    metadataCache: {
      getFileCache: jest.fn(
        () => ({ frontmatter, tags: [{ tag: "#inline-only" }] }) as unknown as CachedMetadata
      ),
      on: jest.fn((_event: string, callback: (changed: TFile) => void) => {
        metadataListeners.add(callback);
        return { callback };
      }),
      offref: metadataOffRef,
    },
  } as unknown as App;

  return {
    app,
    file: activeFile,
    view,
    sourceContainer,
    readingContainer,
    get nativeRow() {
      return nativeRow;
    },
    get nativeInput() {
      return nativeRow.querySelector<HTMLElement>(".multi-select-input") as HTMLElement;
    },
    outside,
    setFrontmatter(value) {
      frontmatter = value;
    },
    setMode(nextMode) {
      mode = nextMode;
    },
    replaceNativeRow(key = "tags") {
      const replacement = createNativeRow(document.createElement("div"), key);
      nativeRow.replaceWith(replacement);
      nativeRow = replacement;
      return replacement;
    },
    emitMetadataChanged() {
      metadataListeners.forEach((listener) => listener(activeFile));
    },
    emitActiveLeafChange() {
      activeLeafListeners.forEach((listener) => listener());
    },
    emitLayoutChange() {
      layoutListeners.forEach((listener) => listener());
    },
    metadataOffRef,
    workspaceOffRef,
  };
}

function suggestionLabels(container: ParentNode): string[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-label^='Add #']")
  ).map((button) => button.getAttribute("aria-label")?.replace("Add #", "") ?? "");
}

describe("TagSuggestionRow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.replaceChildren();
  });

  it(`swaps directly before the native row with native anatomy, frontmatter tags, and two ghosts (${ISSUE})`, () => {
    const ctx = context();
    ctx.setFrontmatter({ tags: [2024, "existing"] });
    const row = new TagSuggestionRow(ctx.app);

    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);

    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");
    expect(mounted?.nextElementSibling).toBe(ctx.nativeRow);
    expect(ctx.nativeRow.hidden).toBe(false);
    expect(ctx.nativeRow.getAttribute("style")).toBeNull();
    expect(readFileSync("src/styles/tailwind.css", "utf8")).toContain(
      '.copilot-tag-suggestion-row + .metadata-property[data-property-key="tags"]'
    );
    expect(mounted?.tabIndex).toBe(-1);
    expect(mounted?.querySelector(".metadata-property-icon [data-icon='tags']")).not.toBeNull();
    expect(mounted?.querySelector<HTMLInputElement>(".metadata-property-key-input")?.value).toBe(
      "tags"
    );
    expect(mounted?.querySelector(".multi-select-pill:not(button)")?.textContent).toBe("existing");
    expect(mounted?.textContent).not.toContain("inline-only");
    expect(suggestionLabels(mounted as HTMLElement)).toEqual(["tag-1", "tag-2"]);
  });

  it(`uses the singular property's own name and refuses notes without tag properties (${ISSUE})`, () => {
    const singular = context({ key: "tag" });
    const singularRow = new TagSuggestionRow(singular.app);
    expect(singularRow.showLoading(singular.file, singular.view)).toBe(true);
    expect(
      singular.sourceContainer.querySelector<HTMLInputElement>(".metadata-property-key-input")
        ?.value
    ).toBe("tag");

    document.body.replaceChildren();
    const missing = context({ withProperty: false });
    const missingRow = new TagSuggestionRow(missing.app);
    expect(missingRow.showLoading(missing.file, missing.view)).toBe(false);
    expect(missing.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
  });

  it(`shows the loading placeholder and replaces it with two ranked pills (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);

    row.showLoading(ctx.file, ctx.view);
    expect(
      ctx.sourceContainer.querySelector(".copilot-tag-suggestion-placeholder")?.textContent
    ).toBe("Suggesting…");

    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-placeholder")).toBeNull();
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-1", "tag-2"]);
  });

  it(`keeps the same focused row alive when a clicked pill disappears and refills (${ISSUE})`, async () => {
    const ctx = context();
    const update = jest.fn().mockResolvedValue(true);
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(3), update, ctx.view);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");
    const first = mounted?.querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]');
    first?.focus();

    first?.click();

    expect(document.activeElement).toBe(mounted);
    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-2", "tag-3"]);
    await waitFor(() => expect(update).toHaveBeenCalledWith(["tag-1"], []));
    expect(row.hasSession(ctx.file)).toBe(true);
  });

  it(`renders pending adds as solid and keeps pending removes out of both lists (${ISSUE})`, async () => {
    const ctx = context();
    ctx.setFrontmatter({ tags: ["tag-1"] });
    let finish: ((updated: boolean) => void) | undefined;
    const update = jest.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(3), update, ctx.view);

    ctx.sourceContainer.querySelector<HTMLElement>('[aria-label="Remove #tag-1"]')?.click();

    expect(ctx.sourceContainer.querySelector('[aria-label="Remove #tag-1"]')).toBeNull();
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-2", "tag-3"]);
    finish?.(false);
    await waitFor(() =>
      expect(ctx.sourceContainer.querySelector('[aria-label="Remove #tag-1"]')).not.toBeNull()
    );

    ctx.setFrontmatter({ tags: [] });
    ctx.emitMetadataChanged();
    ctx.sourceContainer
      .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
      ?.click();

    expect(ctx.sourceContainer.querySelector('[aria-label="Remove #tag-1"]')).not.toBeNull();
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-2", "tag-3"]);
    finish?.(false);
    await waitFor(() => expect(suggestionLabels(ctx.sourceContainer)).toContain("tag-1"));
  });

  it(`derives add, remove, and returned suggestions from one immutable ranking (${ISSUE})`, async () => {
    const ctx = context();
    ctx.setFrontmatter({ tags: [] });
    const update = jest.fn(async (add: string[], remove: string[]) => {
      const current = (
        (ctx.app.metadataCache.getFileCache(ctx.file)?.frontmatter?.tags ?? []) as string[]
      ).filter((tag) => !remove.includes(tag));
      ctx.setFrontmatter({ tags: [...current, ...add] });
      ctx.emitMetadataChanged();
      return true;
    });
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(3), update, ctx.view);

    ctx.sourceContainer
      .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
      ?.click();
    await waitFor(() =>
      expect(ctx.sourceContainer.querySelector('[aria-label="Remove #tag-1"]')).not.toBeNull()
    );
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-2", "tag-3"]);

    ctx.sourceContainer.querySelector<HTMLElement>('[aria-label="Remove #tag-1"]')?.click();
    await waitFor(() => expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-1", "tag-2"]));
    ctx.sourceContainer
      .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
      ?.click();

    await waitFor(() => expect(update).toHaveBeenLastCalledWith(["tag-1"], []));
    expect(update.mock.calls).toEqual([
      [["tag-1"], []],
      [[], ["tag-1"]],
      [["tag-1"], []],
    ]);
  });

  it(`shows fewer ghosts only when the ranked list runs out (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(1), jest.fn().mockResolvedValue(true), ctx.view);

    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-1"]);
  });

  it(`keeps the session and row identity when metadata removes the focused pill (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(3), jest.fn().mockResolvedValue(true), ctx.view);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");
    mounted?.querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')?.focus();

    ctx.setFrontmatter({ tags: ["existing", "tag-1"] });
    ctx.emitMetadataChanged();

    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(document.activeElement).toBe(mounted);
    expect(row.hasSession(ctx.file)).toBe(true);
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-2", "tag-3"]);
  });

  it(`re-inserts the same focused row when Obsidian redraws Properties during a write (${ISSUE})`, async () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    let mounted: HTMLElement | null = null;
    const update = jest.fn(async (add: string[]) => {
      mounted?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      mounted?.remove();
      const replacement = ctx.replaceNativeRow();
      ctx.setFrontmatter({ tags: ["existing", ...add] });
      ctx.emitMetadataChanged();
      expect(replacement.previousElementSibling).toBe(mounted);
      return true;
    });
    row.show(ctx.file, suggestions(3), update, ctx.view);
    mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

    mounted?.querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')?.click();

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(document.activeElement).toBe(mounted);
    expect(row.hasSession(ctx.file)).toBe(true);
  });

  it(`re-focuses a row re-attached after the pending-write fallback clears (${ISSUE})`, async () => {
    jest.useFakeTimers();
    try {
      const ctx = context();
      const row = new TagSuggestionRow(ctx.app);
      row.show(ctx.file, suggestions(3), jest.fn().mockResolvedValue(true), ctx.view);
      const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

      mounted?.querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')?.click();
      await Promise.resolve();
      mounted?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      mounted?.remove();
      expect(document.activeElement).toBe(document.body);

      await jest.advanceTimersByTimeAsync(2_000);

      expect(ctx.nativeRow.previousElementSibling).toBe(mounted);
      expect(document.activeElement).toBe(mounted);
      expect(row.hasSession(ctx.file)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(["q", "Backspace"])(
    `hands %s to the native input and suppresses re-triggering until native focus leaves (${ISSUE})`,
    (key) => {
      const ctx = context();
      const row = new TagSuggestionRow(ctx.app);
      row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
      const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

      mounted?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

      expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
      expect(document.activeElement).toBe(ctx.nativeInput);
      expect(row.isNativeFocusSuppressed(ctx.nativeRow)).toBe(true);
      ctx.nativeRow.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: ctx.outside })
      );
      expect(row.isNativeFocusSuppressed(ctx.nativeRow)).toBe(false);
    }
  );

  it(`keeps Space on a focused suggestion button (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");
    const suggestion = mounted?.querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]');
    suggestion?.focus();

    suggestion?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(document.activeElement).toBe(suggestion);
    expect(row.isNativeFocusSuppressed(ctx.nativeRow)).toBe(false);
  });

  it(`hands an empty-area click to the native input without preventing the click (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
    const emptyArea = ctx.sourceContainer.querySelector<HTMLElement>(
      ".copilot-tag-suggestion-row .multi-select-container"
    );
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    expect(emptyArea?.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(ctx.nativeInput);
  });

  it.each(["focusout", "Escape", "view change", "unload"])(
    `ends the session on %s and restores the native row (${ISSUE})`,
    (reason) => {
      const ctx = context();
      const row = new TagSuggestionRow(ctx.app);
      row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
      const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

      if (reason === "focusout") {
        mounted?.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: ctx.outside })
        );
      } else if (reason === "Escape") {
        mounted?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } else if (reason === "view change") {
        ctx.view.file = file("Projects/Other.md");
        ctx.emitActiveLeafChange();
      } else {
        row.onunload();
      }

      expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
      expect(ctx.nativeRow.isConnected).toBe(true);
      expect(ctx.metadataOffRef).toHaveBeenCalledTimes(1);
      expect(ctx.workspaceOffRef).toHaveBeenCalledTimes(3);
    }
  );

  it(`does not re-enter cleanup when removing the focused row dispatches focusout (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");
    let dispatched = false;
    if (mounted) {
      mounted.remove = () => {
        if (!dispatched) {
          dispatched = true;
          mounted.dispatchEvent(
            new FocusEvent("focusout", { bubbles: true, relatedTarget: ctx.outside })
          );
        }
        mounted.parentNode?.removeChild(mounted);
      };
    }

    mounted?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(ctx.metadataOffRef).toHaveBeenCalledTimes(1);
    expect(ctx.workspaceOffRef).toHaveBeenCalledTimes(3);
    expect(row.hasSession(ctx.file)).toBe(false);
  });

  it(`moves the persistent row to the active mode and a replaced native row (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(), jest.fn().mockResolvedValue(true), ctx.view);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

    ctx.setMode("preview");
    ctx.emitLayoutChange();
    expect(ctx.readingContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);

    ctx.setMode("source");
    const replacement = ctx.replaceNativeRow();
    ctx.emitMetadataChanged();
    expect(replacement.previousElementSibling).toBe(mounted);
  });

  it(`removes a loading session when a request finishes without a result (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    const generation = row.beginRequest(ctx.file);
    row.showLoading(ctx.file, ctx.view);

    row.finishRequest(ctx.file, generation);

    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
    expect(row.isRequestInFlight(ctx.file)).toBe(false);
  });

  it(`keeps the live row and quietly re-ranks when a source tag disappears (${ISSUE})`, () => {
    const ctx = context();
    const rerank = jest.fn();
    const update = jest.fn().mockResolvedValue(true);
    const row = new TagSuggestionRow(ctx.app);
    row.show(ctx.file, suggestions(3), update, ctx.view, ["existing"], rerank);
    const mounted = ctx.sourceContainer.querySelector<HTMLElement>(".copilot-tag-suggestion-row");

    ctx.setFrontmatter({ tags: ["added-later"] });
    ctx.emitMetadataChanged();

    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(
      ctx.sourceContainer.querySelector(".copilot-tag-suggestion-placeholder")?.textContent
    ).toBe("Suggesting…");
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(row.isSessionLoading(ctx.file)).toBe(true);

    ctx.emitMetadataChanged();
    expect(rerank).toHaveBeenCalledTimes(1);

    row.show(ctx.file, suggestions(2), update, ctx.view, ["added-later"], rerank);
    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-row")).toBe(mounted);
    expect(ctx.sourceContainer.querySelector(".copilot-tag-suggestion-placeholder")).toBeNull();
    expect(suggestionLabels(ctx.sourceContainer)).toEqual(["tag-1", "tag-2"]);
  });

  it(`caches immutable rankings for ten minutes and at most fifty notes (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    const ranked = suggestions(2);
    row.cacheSuggestions(ctx.file, ranked, ["#Existing"], 1_000);
    ranked.pop();
    expect(row.getCachedSuggestions(ctx.file, 1_000 + 10 * 60 * 1_000)).toEqual({
      ranked: suggestions(2),
      sourceTags: ["existing"],
    });
    expect(row.getCachedSuggestions(ctx.file, 1_000 + 10 * 60 * 1_000 + 1)).toBeUndefined();

    const notes = Array.from({ length: 51 }, (_, index) => file(`Notes/${index}.md`));
    notes.forEach((note, index) => row.cacheSuggestions(note, suggestions(1), [], index));
    expect(row.getCachedSuggestions(notes[0], 51)).toBeUndefined();
    expect(row.getCachedSuggestions(notes[50], 51)).toEqual({
      ranked: suggestions(1),
      sourceTags: [],
    });
  });

  it(`drops a cached ranking when a source tag disappears but not when tags are added (${ISSUE})`, () => {
    const ctx = context();
    const row = new TagSuggestionRow(ctx.app);
    row.cacheSuggestions(ctx.file, suggestions(2), ["existing"], 1_000);

    ctx.setFrontmatter({ tags: ["existing", "added-later"] });
    expect(row.getCachedSuggestions(ctx.file, 1_001)).toEqual({
      ranked: suggestions(2),
      sourceTags: ["existing"],
    });

    ctx.setFrontmatter({ tags: ["added-later"] });
    expect(row.getCachedSuggestions(ctx.file, 1_002)).toBeUndefined();

    ctx.setFrontmatter({ tags: ["existing", "added-later"] });
    expect(row.getCachedSuggestions(ctx.file, 1_003)).toBeUndefined();
  });
});
