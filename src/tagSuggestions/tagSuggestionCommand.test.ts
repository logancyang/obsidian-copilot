import type {
  NoulQuestion,
  RankedTagSuggestion,
  TagSuggestionState,
} from "@/tagSuggestions/tagSuggestions";
import type { App } from "obsidian";

const mockCheckIsPaidUser = jest.fn<Promise<boolean | undefined>, unknown[]>();
const mockBroca = jest.fn<Promise<Record<string, { noul: number }>>, unknown[]>();
const mockModalOpen = jest.fn<void, []>();
const mockLogInfo = jest.fn<void, unknown[]>();
const mockModal = jest.fn<
  void,
  [App, RankedTagSuggestion[], (tag: string) => void | Promise<void>]
>();
let chooseTag: ((tag: string) => void | Promise<void>) | undefined;

jest.mock("@/plusUtils", () => ({
  checkIsPaidUser: async (...args: unknown[]): Promise<boolean | undefined> =>
    await mockCheckIsPaidUser(...args),
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ userId: "user-1", debug: false }),
}));
jest.mock("@/logger", () => ({
  logInfo: (...args: unknown[]) => mockLogInfo(...args),
  logError: jest.fn(),
}));
jest.mock("@/LLMProviders/brevilabsClient", () => {
  const actual = jest.requireActual<typeof import("@/LLMProviders/brevilabsClient")>(
    "@/LLMProviders/brevilabsClient"
  );
  return {
    ...actual,
    BrevilabsClient: { getInstance: () => ({ broca: mockBroca }) },
  };
});
jest.mock("@/components/modals/TagSuggestionModal", () => ({
  TagSuggestionModal: jest
    .fn()
    .mockImplementation(
      (
        app: App,
        suggestions: RankedTagSuggestion[],
        onChoose: (tag: string) => void | Promise<void>
      ) => {
        chooseTag = onChoose;
        mockModal(app, suggestions, onChoose);
        return { open: mockModalOpen };
      }
    ),
}));

import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import { suggestTagsForCurrentNote } from "@/tagSuggestions/tagSuggestionCommand";
import { CachedMetadata, Notice, TFile } from "obsidian";

function note(path: string, mtime: number): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  const value = new TFileConstructor(path);
  Object.assign(value, {
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { mtime },
  });
  return value;
}

function createApp(active: TFile | null = note("Projects/Active.md", 20), candidateCount = 1) {
  const others = Array.from({ length: candidateCount }, (_, index) =>
    note(index === 0 ? "Projects/Research.md" : `Projects/Topic ${index}.md`, index)
  );
  const cacheEntries: Array<[TFile, CachedMetadata]> = others.map((other, index) => [
    other,
    {
      frontmatter: { tags: [index === 0 ? "research" : `topic-${index}`] },
    } as unknown as CachedMetadata,
  ]);
  if (active) {
    cacheEntries.push([
      active,
      { frontmatter: { tags: ["existing"] } } as unknown as CachedMetadata,
    ]);
  }
  const caches = new Map<TFile, CachedMetadata>(cacheEntries);
  const frontmatter: Record<string, unknown> = {};
  const app = {
    workspace: { getActiveFile: jest.fn(() => active) },
    vault: {
      getMarkdownFiles: jest.fn(() => (active ? [active, ...others] : others)),
      cachedRead: jest.fn().mockResolvedValue("Active note body"),
    },
    metadataCache: { getFileCache: jest.fn((file: TFile) => caches.get(file) ?? null) },
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      ),
    },
  } as unknown as App;
  return { app, frontmatter };
}

function loadingNotice(): { hide: jest.Mock } | undefined {
  const notice = jest.mocked(Notice);
  const index = notice.mock.calls.findIndex(([message]) => message === "Suggesting tags…");
  return notice.mock.instances[index] as unknown as { hide: jest.Mock } | undefined;
}

describe("tagSuggestionCommand", () => {
  describe("suggestTagsForCurrentNote()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      chooseTag = undefined;
      mockCheckIsPaidUser.mockResolvedValue(true);
      mockBroca.mockResolvedValue({ t0: { noul: 0.85 } });
    });

    it("shows a ranked modal and writes the selected tag", async () => {
      const { app, frontmatter } = createApp();

      await suggestTagsForCurrentNote(app);

      const [state, questions] = mockBroca.mock.calls[0] as [
        TagSuggestionState,
        Record<string, NoulQuestion>,
      ];
      expect(state).toMatchObject({ title: "Active", existing_tags: ["existing"] });
      expect(questions.t0).toMatchObject({ type: "noul" });
      expect(mockModal).toHaveBeenCalledWith(
        app,
        [{ tag: "research", score: 0.85 }],
        expect.any(Function)
      );
      expect(mockModalOpen).toHaveBeenCalled();
      expect(mockLogInfo).toHaveBeenCalledTimes(1);
      expect(mockLogInfo).toHaveBeenCalledWith("[Tag suggestion judgments]", [
        { tag: "research", noul: 0.85, rank: 1 },
      ]);

      await chooseTag?.("research");

      expect(frontmatter.tags).toEqual(["research"]);
      expect(Notice).toHaveBeenCalledWith("Added #research");
    });

    it("logs one entry containing only the ten suggestions shown", async () => {
      const { app } = createApp(note("Projects/Active.md", 20), 11);
      mockBroca.mockImplementation(async (_state, questions: Record<string, NoulQuestion>) =>
        Object.fromEntries(
          Object.keys(questions).map((id, index) => [id, { noul: 1 - index / 100 }])
        )
      );

      await suggestTagsForCurrentNote(app);

      const suggestions = mockModal.mock.calls[0][1];
      const judgments = mockLogInfo.mock.calls[0][1] as Array<{
        tag: string;
        noul: number;
        rank: number;
      }>;
      expect(mockLogInfo).toHaveBeenCalledTimes(1);
      expect(judgments).toHaveLength(10);
      expect(judgments.map(({ tag }) => tag)).toEqual(suggestions.map(({ tag }) => tag));
      expect(judgments.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("does not call Jev without an active Markdown note (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      const { app } = createApp(null);

      await suggestTagsForCurrentNote(app);

      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Open a Markdown note before suggesting tags.");
    });

    it("does not call Jev without a valid paid license (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      mockCheckIsPaidUser.mockResolvedValue(false);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app);

      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "A valid Copilot Plus license is required to suggest tags."
      );
    });

    it("does not call Jev when the vault has no usable candidate tags (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      const { app } = createApp();
      const active = app.workspace.getActiveFile();
      jest.mocked(app.vault.getMarkdownFiles).mockReturnValue(active ? [active] : []);

      await suggestTagsForCurrentNote(app);

      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("This vault has no other tags to suggest for this note.");
    });

    it.each([
      [403, "A valid Copilot Plus license is required to suggest tags."],
      [413, "This vault has too much tag data to suggest tags."],
      [429, "Tag suggestions are rate limited. Try again later."],
      [504, "Tag suggestions timed out. Try again."],
    ])(
      "shows the HTTP %i fallback and closes the loading notice (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)",
      async (status, expected) => {
        mockBroca.mockRejectedValue(new BrevilabsApiError("failed", status));
        const { app } = createApp();

        await suggestTagsForCurrentNote(app);

        expect(Notice).toHaveBeenCalledWith(expected);
        expect(loadingNotice()?.hide).toHaveBeenCalled();
      }
    );

    it("shows the network fallback and closes the loading notice (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      mockBroca.mockRejectedValue(new Error("offline"));
      const { app } = createApp();

      await suggestTagsForCurrentNote(app);

      expect(Notice).toHaveBeenCalledWith(
        "Couldn’t suggest tags. Check your connection and try again."
      );
      expect(loadingNotice()?.hide).toHaveBeenCalled();
    });
  });
});
