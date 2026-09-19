import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { waitFor } from "@testing-library/react";
import type { App, CachedMetadata, EventRef, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { Notice, TFile as ObsidianTFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";

interface TestContext {
  app: App;
  file: TFile;
  view: MarkdownView;
  contentEl: HTMLElement;
  metadataContainer: HTMLElement;
  sourceMetadataContainer: HTMLElement;
  readingMetadataContainer: HTMLElement;
  modeRoot: HTMLElement;
  setTags(tags: string[]): void;
  setMode(mode: "source" | "preview"): void;
  emitMetadataChanged(): void;
  emitActiveLeafChange(): void;
  emitFileOpen(): void;
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

function scoredSuggestions(scores: number[]): RankedTagSuggestion[] {
  return scores.map((score, index) => ({ tag: `tag-${index + 1}`, score }));
}

function testContext(
  options: { tagsRow?: boolean; properties?: number; mode?: "source" | "preview" } = {}
): TestContext {
  const activeFile = file("Projects/Active.md");
  const contentEl = document.createElement("div");
  const sourceRoot = contentEl.createDiv({ cls: "markdown-source-view" });
  const readingRoot = contentEl.createDiv({ cls: "markdown-reading-view" });
  const sourceMetadataContainer = sourceRoot.createDiv({ cls: "metadata-container" });
  const readingMetadataContainer = readingRoot.createDiv({ cls: "metadata-container" });
  let mode = options.mode ?? "source";
  const metadataContainer = mode === "preview" ? readingMetadataContainer : sourceMetadataContainer;
  const inactiveMetadataContainer =
    mode === "preview" ? sourceMetadataContainer : readingMetadataContainer;
  const propertyCount = options.properties ?? 2;
  for (const container of [metadataContainer, inactiveMetadataContainer]) {
    for (let index = 0; index < propertyCount; index++) {
      container.createDiv({
        cls: "metadata-property",
        attr: {
          "data-property-key": options.tagsRow && index === 0 ? "tags" : `property-${index}`,
        },
      });
    }
  }
  document.body.appendChild(contentEl);

  const view = {
    file: activeFile,
    contentEl,
    getMode: jest.fn(() => mode),
  } as unknown as MarkdownView;
  const leaf = { view } as unknown as WorkspaceLeaf;
  let tags: string[] = [];
  const metadataListeners = new Set<(changed: TFile) => void>();
  const activeLeafListeners = new Set<() => void>();
  const fileOpenListeners = new Set<() => void>();
  const layoutChangeListeners = new Set<() => void>();
  const metadataOffRef = jest.fn((ref: EventRef) => {
    metadataListeners.delete((ref as unknown as { callback: (changed: TFile) => void }).callback);
  });
  const workspaceOffRef = jest.fn((ref: EventRef) => {
    const callback = (ref as unknown as { callback: () => void }).callback;
    activeLeafListeners.delete(callback);
    fileOpenListeners.delete(callback);
    layoutChangeListeners.delete(callback);
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
              ? layoutChangeListeners
              : activeLeafListeners;
        listeners.add(callback);
        return { callback };
      }),
      offref: workspaceOffRef,
    },
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter: { tags } }) as unknown as CachedMetadata),
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
    contentEl,
    metadataContainer,
    sourceMetadataContainer,
    readingMetadataContainer,
    modeRoot: mode === "preview" ? readingRoot : sourceRoot,
    setTags(nextTags) {
      tags = nextTags;
    },
    setMode(nextMode) {
      mode = nextMode;
    },
    emitMetadataChanged() {
      metadataListeners.forEach((listener) => listener(activeFile));
    },
    emitActiveLeafChange() {
      activeLeafListeners.forEach((listener) => listener());
    },
    emitFileOpen() {
      fileOpenListeners.forEach((listener) => listener());
    },
    emitLayoutChange() {
      layoutChangeListeners.forEach((listener) => listener());
    },
    metadataOffRef,
    workspaceOffRef,
  };
}

function labels(container: ParentNode): string[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-label^='Add #']")
  ).map((button) => button.getAttribute("aria-label")?.replace("Add #", "") ?? "");
}

describe("tagSuggestionRow", () => {
  describe("TagSuggestionRow", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      document.body.replaceChildren();
    });

    describe("show()", () => {
      it(`mounts five suggestions above the tags property and replaces an existing row (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        const mounted = context.metadataContainer.querySelectorAll(".copilot-tag-suggestion-row");
        const tagsProperty = context.metadataContainer.querySelector(
          '.metadata-property[data-property-key="tags"]'
        );
        expect(mounted).toHaveLength(1);
        expect(tagsProperty?.previousElementSibling).toBe(mounted[0]);
        expect(labels(context.metadataContainer)).toEqual([
          "tag-1",
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
        ]);
      });

      it.each([
        ["source", "sourceMetadataContainer", "readingMetadataContainer"],
        ["preview", "readingMetadataContainer", "sourceMetadataContainer"],
      ] as const)(
        `mounts in the active %s mode when both Properties containers exist (${ISSUE})`,
        (mode, activeKey, inactiveKey) => {
          const context = testContext({ tagsRow: true, mode });
          const row = new TagSuggestionRow(context.app);

          row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

          expect(labels(context[activeKey])).toHaveLength(5);
          expect(labels(context[inactiveKey])).toHaveLength(0);
        }
      );

      it(`moves the row when the Markdown view changes mode (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        context.setMode("preview");
        context.emitLayoutChange();

        expect(labels(context.sourceMetadataContainer)).toHaveLength(0);
        expect(labels(context.readingMetadataContainer)).toHaveLength(5);
      });

      it(`mounts after the last property when the note has no tags property (${ISSUE})`, () => {
        const context = testContext({ properties: 3 });
        const lastProperty = context.metadataContainer.lastElementChild;
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(lastProperty?.nextElementSibling?.classList).toContain("copilot-tag-suggestion-row");
      });

      it(`mounts the row after a hidden Properties container without opening a modal (${ISSUE})`, () => {
        const context = testContext();
        context.metadataContainer.classList.add("is-hidden");
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(context.metadataContainer.nextElementSibling?.classList).toContain(
          "copilot-tag-suggestion-row"
        );
        expect(labels(context.modeRoot)).toEqual(["tag-1", "tag-2", "tag-3", "tag-4", "tag-5"]);
      });

      it(`mounts outside an ancestor that hides Properties (${ISSUE})`, () => {
        const context = testContext();
        const hiddenWrapper = context.modeRoot.createDiv({ cls: "is-hidden" });
        hiddenWrapper.appendChild(context.metadataContainer);
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(hiddenWrapper.nextElementSibling?.classList).toContain("copilot-tag-suggestion-row");
        expect(hiddenWrapper.querySelector(".copilot-tag-suggestion-row")).toBeNull();
      });

      it(`moves a hidden-panel row under tags after the first write creates frontmatter (${ISSUE})`, async () => {
        const context = testContext({ tagsRow: true });
        context.metadataContainer.classList.add("is-hidden");
        const addTag = jest.fn(async (tags: string[]) => {
          context.setTags(tags);
          context.metadataContainer.classList.remove("is-hidden");
          context.emitMetadataChanged();
          return true;
        });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), addTag);

        context.modeRoot
          .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
          ?.click();

        await waitFor(() => expect(addTag).toHaveBeenCalledWith(["tag-1"]));
        const tagsProperty = context.metadataContainer.querySelector(
          '.metadata-property[data-property-key="tags"]'
        );
        expect(tagsProperty?.previousElementSibling?.classList).toContain(
          "copilot-tag-suggestion-row"
        );
        expect(labels(context.metadataContainer)).toEqual([
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
          "tag-6",
        ]);
      });

      it(`shows a notice and ends the session when the mode has no Properties container (${ISSUE})`, () => {
        const context = testContext();
        context.metadataContainer.remove();
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(Notice).toHaveBeenCalledWith("Couldn’t show tag suggestions in this note.");
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);
      });

      it(`removes a clicked pill immediately and refills from the ranked list (${ISSUE})`, async () => {
        const context = testContext({ tagsRow: true });
        const addTag = jest.fn().mockResolvedValue(true);
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), addTag);

        context.metadataContainer
          .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
          ?.click();

        expect(labels(context.metadataContainer)).toEqual([
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
          "tag-6",
        ]);
        await waitFor(() => expect(addTag).toHaveBeenCalledWith(["tag-1"]));
      });

      it(`restores a clicked pill when the frontmatter write fails (${ISSUE})`, async () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), jest.fn().mockResolvedValue(false));

        context.metadataContainer
          .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
          ?.click();

        await waitFor(() =>
          expect(labels(context.metadataContainer)).toEqual([
            "tag-1",
            "tag-2",
            "tag-3",
            "tag-4",
            "tag-5",
          ])
        );
      });

      it(`filters manually added tags and fills the visible row from the remaining queue (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), jest.fn().mockResolvedValue(true));

        context.setTags(["tag-2"]);
        context.emitMetadataChanged();

        expect(labels(context.metadataContainer)).toEqual([
          "tag-1",
          "tag-3",
          "tag-4",
          "tag-5",
          "tag-6",
        ]);
      });

      it(`returns a clicked tag in ranked position after it is removed from the note (${ISSUE})`, async () => {
        const context = testContext({ tagsRow: true });
        const addTag = jest.fn(async (tags: string[]) => {
          context.setTags(tags);
          context.emitMetadataChanged();
          return true;
        });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), addTag);

        context.metadataContainer
          .querySelector<HTMLButtonElement>('button[aria-label="Add #tag-1"]')
          ?.click();
        await waitFor(() => expect(addTag).toHaveBeenCalledWith(["tag-1"]));

        context.setTags([]);
        context.emitMetadataChanged();

        expect(labels(context.metadataContainer)).toEqual([
          "tag-1",
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
        ]);
      });

      it(`returns a manually added candidate in ranked position after it is removed (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(6), jest.fn().mockResolvedValue(true));

        context.setTags(["tag-2"]);
        context.emitMetadataChanged();
        context.setTags([]);
        context.emitMetadataChanged();

        expect(labels(context.metadataContainer)).toEqual([
          "tag-1",
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
        ]);
      });

      it(`hides an exhausted row but keeps the session so a removed tag returns (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(2), jest.fn().mockResolvedValue(true));

        context.setTags(["tag-1", "tag-2"]);
        context.emitMetadataChanged();

        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).not.toHaveBeenCalled();
        expect(context.workspaceOffRef).not.toHaveBeenCalled();

        context.setTags(["tag-2"]);
        context.emitMetadataChanged();

        expect(labels(context.metadataContainer)).toEqual(["tag-1"]);
      });

      it(`removes the row and listeners on close and plugin unload (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        context.metadataContainer
          .querySelector<HTMLButtonElement>('button[aria-label="Close tag suggestions"]')
          ?.click();

        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.onunload();
        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(2);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(6);
      });

      it(`shows one non-clickable placeholder pill until ranked suggestions arrive (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);

        row.showLoading(context.file);

        const placeholder = context.metadataContainer.querySelector(
          ".copilot-tag-suggestion-placeholder"
        );
        expect(placeholder?.textContent).toBe("Suggesting tags…");
        expect(placeholder?.tagName).toBe("SPAN");
        expect(
          context.metadataContainer.querySelectorAll("button[aria-label^='Add #']")
        ).toHaveLength(0);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(
          context.metadataContainer.querySelector(".copilot-tag-suggestion-placeholder")
        ).toBeNull();
        expect(labels(context.metadataContainer)).toHaveLength(5);
      });

      it(`counts Auto-add from all ten ranked tags and caps one write at three (${ISSUE})`, async () => {
        const context = testContext({ tagsRow: true });
        const addTags = jest.fn(async (tags: string[]) => {
          context.setTags(tags);
          context.emitMetadataChanged();
          return true;
        });
        const row = new TagSuggestionRow(context.app);
        row.show(
          context.file,
          scoredSuggestions([0.99, 0.95, 0.9, 0.86, 0.84, 0.8, 0.7, 0.6, 0.5, 0.4]),
          addTags
        );

        const autoAdd = context.metadataContainer.querySelector<HTMLButtonElement>(
          'button[aria-label="Auto-add 3 tags"]'
        );
        expect(autoAdd?.textContent).toBe("Auto-add 3");
        autoAdd?.click();

        expect(labels(context.metadataContainer)).toEqual([
          "tag-4",
          "tag-5",
          "tag-6",
          "tag-7",
          "tag-8",
        ]);
        await waitFor(() => expect(addTags).toHaveBeenCalledWith(["tag-1", "tag-2", "tag-3"]));
        expect(addTags).toHaveBeenCalledTimes(1);
      });

      it(`hides Auto-add when no remaining ranked tag reaches the provisional threshold (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, scoredSuggestions([0.84, 0.8, 0.7]), jest.fn());

        expect(context.metadataContainer.querySelector(".copilot-tag-auto-add-pill")).toBeNull();
      });

      it(`does not retain closed session refs in the long-lived component (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        const registerEvent = jest.spyOn(row, "registerEvent");

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.close();

        expect(registerEvent).not.toHaveBeenCalled();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);
      });

      it(`re-mounts after Obsidian replaces the Properties rows (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        const replacement = context.metadataContainer.doc.createElement("div");
        replacement.className = "metadata-property";
        replacement.dataset.propertyKey = "tags";
        context.metadataContainer.replaceChildren(replacement);

        context.emitMetadataChanged();

        expect(replacement.previousElementSibling?.classList).toContain(
          "copilot-tag-suggestion-row"
        );
        expect(labels(context.metadataContainer)).toHaveLength(5);
      });

      it(`removes the row when its Markdown view changes file (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        context.view.file = file("Projects/Other.md");
        context.emitActiveLeafChange();

        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);
      });

      it(`removes a hidden-panel row when another Markdown view becomes active (${ISSUE})`, () => {
        const context = testContext();
        context.metadataContainer.classList.add("is-hidden");
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        const otherView = { file: file("Projects/Other.md") } as MarkdownView;

        jest.mocked(context.app.workspace.getActiveViewOfType).mockReturnValue(otherView);
        context.emitActiveLeafChange();

        expect(context.modeRoot.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);
      });

      it(`removes a hidden-panel row when its active leaf opens another file (${ISSUE})`, () => {
        const context = testContext();
        context.metadataContainer.classList.add("is-hidden");
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        context.view.file = file("Projects/Other.md");
        context.emitFileOpen();

        expect(context.modeRoot.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(3);
      });
    });

    describe("request lifecycle", () => {
      it(`invalidates an older generation and reports only the current request (${ISSUE})`, () => {
        const context = testContext();
        const row = new TagSuggestionRow(context.app);

        const first = row.beginRequest(context.file);
        const second = row.beginRequest(context.file);

        expect(row.isCurrentRequest(first)).toBe(false);
        expect(row.isCurrentRequest(second)).toBe(true);
      });

      it(`tracks a request as in flight until its matching generation finishes (${ISSUE})`, () => {
        const context = testContext();
        const row = new TagSuggestionRow(context.app);
        const generation = row.beginRequest(context.file);

        expect(row.isRequestInFlight(context.file)).toBe(true);
        row.finishRequest(context.file, generation + 1);
        expect(row.isRequestInFlight(context.file)).toBe(true);
        row.finishRequest(context.file, generation);
        expect(row.isRequestInFlight(context.file)).toBe(false);
      });
    });

    describe("ranked suggestion cache", () => {
      it(`returns a fresh entry without sharing its mutable array (${ISSUE})`, () => {
        const context = testContext();
        const row = new TagSuggestionRow(context.app);
        const ranked = suggestions(2);

        row.cacheSuggestions(context.file, ranked, 1_000);
        ranked.pop();

        expect(row.getCachedSuggestions(context.file, 1_000 + 10 * 60 * 1_000)).toEqual(
          suggestions(2)
        );
      });

      it(`expires a cached ranking after ten minutes (${ISSUE})`, () => {
        const context = testContext();
        const row = new TagSuggestionRow(context.app);
        row.cacheSuggestions(context.file, suggestions(2), 1_000);

        expect(row.getCachedSuggestions(context.file, 1_000 + 10 * 60 * 1_000 + 1)).toBeUndefined();
      });

      it(`keeps only the fifty most recently cached notes (${ISSUE})`, () => {
        const context = testContext();
        const row = new TagSuggestionRow(context.app);
        const files = Array.from({ length: 51 }, (_, index) => file(`Notes/${index}.md`));

        files.forEach((note, index) => row.cacheSuggestions(note, suggestions(1), index));

        expect(row.getCachedSuggestions(files[0], 51)).toBeUndefined();
        expect(row.getCachedSuggestions(files[50], 51)).toEqual(suggestions(1));
      });
    });
  });
});
