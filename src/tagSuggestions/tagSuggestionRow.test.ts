import type { RankedTagSuggestion } from "@/tagSuggestions/tagSuggestions";
import { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { waitFor } from "@testing-library/react";
import type { App, CachedMetadata, EventRef, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";
const mockModalOpen = jest.fn<void, []>();
const mockModalClose = jest.fn<void, []>();
let chooseFromModal: ((tag: string) => void | Promise<void>) | undefined;

jest.mock("@/components/modals/TagSuggestionModal", () => ({
  TagSuggestionModal: jest
    .fn()
    .mockImplementation(
      (
        _app: App,
        _suggestions: RankedTagSuggestion[],
        onChoose: (tag: string) => void | Promise<void>
      ) => {
        chooseFromModal = onChoose;
        return { open: mockModalOpen, close: mockModalClose };
      }
    ),
}));

interface TestContext {
  app: App;
  file: TFile;
  view: MarkdownView;
  contentEl: HTMLElement;
  metadataContainer: HTMLElement;
  setTags(tags: string[]): void;
  emitMetadataChanged(): void;
  emitActiveLeafChange(): void;
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

function testContext(options: { tagsRow?: boolean; properties?: number } = {}): TestContext {
  const activeFile = file("Projects/Active.md");
  const contentEl = document.createElement("div");
  const metadataContainer = contentEl.createDiv({ cls: "metadata-container" });
  const propertyCount = options.properties ?? 2;
  for (let index = 0; index < propertyCount; index++) {
    metadataContainer.createDiv({
      cls: "metadata-property",
      attr: { "data-property-key": options.tagsRow && index === 0 ? "tags" : `property-${index}` },
    });
  }
  document.body.appendChild(contentEl);

  const view = {
    file: activeFile,
    contentEl,
  } as unknown as MarkdownView;
  const leaf = { view } as unknown as WorkspaceLeaf;
  let tags: string[] = [];
  const metadataListeners = new Set<(changed: TFile) => void>();
  const workspaceListeners = new Set<() => void>();
  const metadataOffRef = jest.fn((ref: EventRef) => {
    metadataListeners.delete((ref as unknown as { callback: (changed: TFile) => void }).callback);
  });
  const workspaceOffRef = jest.fn((ref: EventRef) => {
    workspaceListeners.delete((ref as unknown as { callback: () => void }).callback);
  });
  const app = {
    workspace: {
      getLeavesOfType: jest.fn(() => [leaf]),
      on: jest.fn((_event: string, callback: () => void) => {
        workspaceListeners.add(callback);
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
    setTags(nextTags) {
      tags = nextTags;
    },
    emitMetadataChanged() {
      metadataListeners.forEach((listener) => listener(activeFile));
    },
    emitActiveLeafChange() {
      workspaceListeners.forEach((listener) => listener());
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
      chooseFromModal = undefined;
      document.body.replaceChildren();
    });

    describe("show()", () => {
      it(`mounts five suggestions after the tags property and replaces an existing row (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        const mounted = context.metadataContainer.querySelectorAll(".copilot-tag-suggestion-row");
        const tagsProperty = context.metadataContainer.querySelector(
          '.metadata-property[data-property-key="tags"]'
        );
        expect(mounted).toHaveLength(1);
        expect(tagsProperty?.nextElementSibling).toBe(mounted[0]);
        expect(labels(context.metadataContainer)).toEqual([
          "tag-1",
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
        ]);
        expect(mockModalOpen).not.toHaveBeenCalled();
      });

      it(`mounts after the last property when the note has no tags property (${ISSUE})`, () => {
        const context = testContext({ properties: 3 });
        const lastProperty = context.metadataContainer.lastElementChild;
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));

        expect(lastProperty?.nextElementSibling?.classList).toContain("copilot-tag-suggestion-row");
      });

      it(`uses the modal without a visible Properties container and lets the row take over after a pick (${ISSUE})`, async () => {
        const context = testContext();
        context.metadataContainer.remove();
        const addTag = jest.fn().mockResolvedValue(true);
        const row = new TagSuggestionRow(context.app);

        row.show(context.file, suggestions(), addTag);
        await chooseFromModal?.("tag-1");
        context.setTags(["tag-1"]);
        context.contentEl.appendChild(context.metadataContainer);
        context.emitMetadataChanged();

        expect(mockModalOpen).toHaveBeenCalledTimes(1);
        expect(addTag).toHaveBeenCalledWith("tag-1");
        expect(mockModalClose).toHaveBeenCalled();
        expect(labels(context.metadataContainer)).toEqual([
          "tag-2",
          "tag-3",
          "tag-4",
          "tag-5",
          "tag-6",
        ]);
      });

      it(`removes a clicked pill immediately and refills from the ranked queue (${ISSUE})`, async () => {
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
        await waitFor(() => expect(addTag).toHaveBeenCalledWith("tag-1"));
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

      it(`reopens the fallback picker when its frontmatter write fails (${ISSUE})`, async () => {
        const context = testContext();
        context.metadataContainer.remove();
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(false));

        await chooseFromModal?.("tag-1");

        expect(mockModalOpen).toHaveBeenCalledTimes(2);
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

      it(`removes an exhausted row and unregisters its listeners (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        row.show(context.file, suggestions(2), jest.fn().mockResolvedValue(true));

        context.setTags(["tag-1", "tag-2"]);
        context.emitMetadataChanged();

        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(1);
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
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(1);

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.onunload();
        expect(context.metadataContainer.querySelector(".copilot-tag-suggestion-row")).toBeNull();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(2);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(2);
      });

      it(`does not retain closed session refs in the long-lived component (${ISSUE})`, () => {
        const context = testContext({ tagsRow: true });
        const row = new TagSuggestionRow(context.app);
        const registerEvent = jest.spyOn(row, "registerEvent");

        row.show(context.file, suggestions(), jest.fn().mockResolvedValue(true));
        row.close();

        expect(registerEvent).not.toHaveBeenCalled();
        expect(context.metadataOffRef).toHaveBeenCalledTimes(1);
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(1);
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

        expect(context.metadataContainer.lastElementChild?.classList).toContain(
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
        expect(context.workspaceOffRef).toHaveBeenCalledTimes(1);
      });
    });
  });
});
