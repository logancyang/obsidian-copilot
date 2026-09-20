import { TagSuggestionFocusTrigger } from "@/tagSuggestions/tagSuggestionFocusTrigger";
import type { TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import type { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";
const mockGetSettings = jest.fn<{ suggestTagsOnPropertyFocus: boolean }, []>();
const mockSuggestTags = jest.fn().mockResolvedValue(undefined);

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));
function file(path: string): TFile {
  const TFileConstructor = ObsidianTFile as unknown as new (path: string) => TFile;
  return new TFileConstructor(path);
}

function context() {
  const contentEl = document.createElement("div");
  const tagsProperty = contentEl.createDiv({
    cls: "metadata-property",
    attr: { "data-property-key": "tags" },
  });
  const input = tagsProperty.createEl("input");
  const elsewhere = contentEl.createEl("input");
  document.body.appendChild(contentEl);
  const activeFile = file("Projects/Active.md");
  const view = { file: activeFile, contentEl } as unknown as MarkdownView;
  const leaf = { view } as unknown as WorkspaceLeaf;
  const windowListeners = new Set<(workspaceWindow: unknown, win: Window) => void>();
  const app = {
    workspace: {
      containerEl: document.body,
      getLeavesOfType: jest.fn(() => [leaf]),
      on: jest.fn((_event: string, callback: (workspaceWindow: unknown, win: Window) => void) => {
        windowListeners.add(callback);
        return { callback };
      }),
    },
  } as unknown as App;
  const row = {
    isNativeFocusSuppressed: jest.fn(() => false),
  } as unknown as TagSuggestionRow;
  const trigger = new TagSuggestionFocusTrigger(app, row, mockSuggestTags);
  trigger.onload();
  return { app, row, view, activeFile, input, elsewhere, windowListeners };
}

describe("tagSuggestionFocusTrigger", () => {
  describe("TagSuggestionFocusTrigger", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      document.body.replaceChildren();
      mockGetSettings.mockReturnValue({ suggestTagsOnPropertyFocus: true });
    });

    describe("onload()", () => {
      it(`starts the shared quiet pipeline when focus enters a Markdown tags property (${ISSUE})`, () => {
        const { app, row, view, input } = context();

        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(mockSuggestTags).toHaveBeenCalledWith(app, row, { quiet: true, view });
      });

      it(`ignores focus outside the tags property (${ISSUE})`, () => {
        const { elsewhere } = context();

        elsewhere.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(mockSuggestTags).not.toHaveBeenCalled();
      });

      it(`silently ignores focus when the setting is off (${ISSUE})`, () => {
        mockGetSettings.mockReturnValue({ suggestTagsOnPropertyFocus: false });
        const { input } = context();

        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(mockSuggestTags).not.toHaveBeenCalled();
      });

      it(`does not reopen while focus is handed back to Obsidian (${ISSUE})`, () => {
        const { row, input } = context();
        jest.mocked(row.isNativeFocusSuppressed).mockReturnValue(true);

        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(mockSuggestTags).not.toHaveBeenCalled();
      });

      it(`registers focus handling for a popout opened after plugin load (${ISSUE})`, () => {
        const { app, row, view, activeFile, windowListeners } = context();
        const frame = document.createElement("iframe");
        document.body.appendChild(frame);
        const popoutDocument = frame.contentDocument as Document;
        const popoutWindow = frame.contentWindow as Window;
        const popoutViewEl = popoutDocument.createElement("div");
        const popoutProperty = popoutDocument.createElement("div");
        popoutProperty.className = "metadata-property";
        popoutProperty.dataset.propertyKey = "tags";
        const popoutInput = popoutDocument.createElement("input");
        popoutProperty.appendChild(popoutInput);
        popoutViewEl.appendChild(popoutProperty);
        popoutDocument.body.appendChild(popoutViewEl);
        const popoutView = {
          file: activeFile,
          contentEl: popoutViewEl,
        } as unknown as MarkdownView;
        jest
          .mocked(app.workspace.getLeavesOfType)
          .mockReturnValue([
            { view } as unknown as WorkspaceLeaf,
            { view: popoutView } as unknown as WorkspaceLeaf,
          ]);

        windowListeners.forEach((listener) => listener({}, popoutWindow));
        popoutInput.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(mockSuggestTags).toHaveBeenCalledWith(app, row, {
          quiet: true,
          view: popoutView,
        });
      });
    });
  });
});
