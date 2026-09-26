import type {
  NoulQuestion,
  RankedTagSuggestion,
  TagSuggestionState,
} from "@/tagSuggestions/tagSuggestions";
import type { CachedTagSuggestions, TagSuggestionRow } from "@/tagSuggestions/tagSuggestionRow";
import { waitFor } from "@testing-library/react";
import type { App } from "obsidian";

const mockCheckIsPlusUser = jest.fn<Promise<boolean>, unknown[]>();
const mockIsPlusEnabled = jest.fn<boolean, unknown[]>();
const mockBroca = jest.fn<Promise<Record<string, { noul: number }>>, unknown[]>();
const mockLogInfo = jest.fn<void, unknown[]>();
const mockLogError = jest.fn<void, unknown[]>();
let latestRequest = 0;
const mockBeginRequest = jest.fn(() => ++latestRequest);
const mockIsCurrentRequest = jest.fn((request: number) => request === latestRequest);
const mockFinishRequest = jest.fn();
const mockShowLoading = jest.fn();
const mockClose = jest.fn();
const mockHasSession = jest.fn<boolean, unknown[]>();
const mockIsSessionLoading = jest.fn<boolean, unknown[]>();
const mockIsRequestInFlight = jest.fn<boolean, unknown[]>();
const mockGetCachedSuggestions = jest.fn<CachedTagSuggestions | undefined, unknown[]>();
const mockCacheSuggestions = jest.fn();
const mockRowShow = jest.fn<
  void,
  [
    import("obsidian").TFile,
    RankedTagSuggestion[],
    (add: string[], remove: string[]) => Promise<boolean>,
    MarkdownView?,
    ReadonlyArray<string>?,
    (() => void)?,
  ]
>();
let updateTags: ((add: string[], remove: string[]) => Promise<boolean>) | undefined;
const suggestionRow = {
  beginRequest: mockBeginRequest,
  isCurrentRequest: mockIsCurrentRequest,
  finishRequest: mockFinishRequest,
  showLoading: mockShowLoading,
  close: mockClose,
  hasSession: mockHasSession,
  isSessionLoading: mockIsSessionLoading,
  isRequestInFlight: mockIsRequestInFlight,
  getCachedSuggestions: mockGetCachedSuggestions,
  cacheSuggestions: mockCacheSuggestions,
  show: mockRowShow,
} as unknown as TagSuggestionRow;

jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: async (...args: unknown[]): Promise<boolean> =>
    await mockCheckIsPlusUser(...args),
  isPlusEnabled: (...args: unknown[]): boolean => mockIsPlusEnabled(...args),
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ userId: "user-1", debug: false }),
}));
jest.mock("@/logger", () => ({
  logInfo: (...args: unknown[]) => mockLogInfo(...args),
  logError: (...args: unknown[]) => mockLogError(...args),
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
import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import { suggestTagsForCurrentNote } from "@/tagSuggestions/tagSuggestionCommand";
import { CachedMetadata, MarkdownView, Notice, TFile } from "obsidian";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/492";

function note(path: string, mtime: number): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  const value = new TFileConstructor(path);
  Object.assign(value, {
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { mtime, ctime: mtime },
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
  const activeView = active ? ({ file: active } as MarkdownView) : null;
  const app = {
    workspace: {
      getActiveFile: jest.fn(() => active),
      getActiveViewOfType: jest.fn(() => activeView),
    },
    vault: {
      getMarkdownFiles: jest.fn(() => (active ? [active, ...others] : others)),
      cachedRead: jest.fn().mockResolvedValue("Active note body"),
    },
    metadataCache: {
      getFileCache: jest.fn((file: TFile) => caches.get(file) ?? null),
      resolvedLinks: {},
    },
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      ),
    },
  } as unknown as App;
  return { app, frontmatter };
}

describe("tagSuggestionCommand", () => {
  describe("suggestTagsForCurrentNote()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      latestRequest = 0;
      updateTags = undefined;
      mockRowShow.mockImplementation((_file, _suggestions, onUpdate) => {
        updateTags = onUpdate;
      });
      mockShowLoading.mockReturnValue(true);
      mockCheckIsPlusUser.mockResolvedValue(true);
      mockIsPlusEnabled.mockReturnValue(true);
      mockHasSession.mockReturnValue(false);
      mockIsSessionLoading.mockReturnValue(false);
      mockIsRequestInFlight.mockReturnValue(false);
      mockGetCachedSuggestions.mockReturnValue(undefined);
      mockBroca.mockResolvedValue({ t0: { noul: 0.85 } });
    });

    it("shows a ranked suggestion row and writes the selected tag", async () => {
      const { app, frontmatter } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      const [state, questions] = mockBroca.mock.calls[0] as [
        TagSuggestionState,
        Record<string, NoulQuestion>,
      ];
      expect(state).toMatchObject({ title: "Active", existing_tags: ["existing"] });
      expect(questions.t0).toMatchObject({ type: "noul" });
      expect(mockRowShow).toHaveBeenCalledWith(
        app.workspace.getActiveFile(),
        [{ tag: "research", score: 0.85 }],
        expect.any(Function),
        app.workspace.getActiveViewOfType(MarkdownView),
        ["existing"],
        expect.any(Function)
      );
      expect(mockLogInfo).toHaveBeenCalledTimes(1);
      expect(mockLogInfo).toHaveBeenCalledWith("[Tag suggestion judgments]", [
        { tag: "research", noul: 0.85, rank: 1 },
      ]);

      await expect(updateTags?.(["research"], [])).resolves.toBe(true);

      expect(frontmatter.tags).toEqual(["research"]);
      expect(Notice).toHaveBeenCalledWith("Added #research");
    });

    it(`adds several tags in one writer call and reports the count (${ISSUE})`, async () => {
      const { app, frontmatter } = createApp();
      await suggestTagsForCurrentNote(app, suggestionRow);

      await expect(updateTags?.(["research", "planning", "next"], [])).resolves.toBe(true);

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(frontmatter.tags).toEqual(["research", "planning", "next"]);
      expect(Notice).toHaveBeenCalledWith("Added 3 tags");
    });

    it(`removes a tag through the same frontmatter writer (${ISSUE})`, async () => {
      const { app, frontmatter } = createApp();
      frontmatter.tags = [2024, "research", "keep"];
      await suggestTagsForCurrentNote(app, suggestionRow);

      await expect(updateTags?.([], ["research"])).resolves.toBe(true);

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(frontmatter.tags).toEqual([2024, "keep"]);
    });

    it(`shows the in-row loading placeholder instead of a loading notice (${ISSUE})`, async () => {
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(mockShowLoading).toHaveBeenCalledWith(
        app.workspace.getActiveFile(),
        app.workspace.getActiveViewOfType(MarkdownView)
      );
      expect(Notice).not.toHaveBeenCalledWith("Suggesting tags…", 0);
    });

    it(`asks for a tags property when the command cannot mount the row (${ISSUE})`, async () => {
      mockShowLoading.mockReturnValue(false);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(app.vault.cachedRead).not.toHaveBeenCalled();
      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Add a tags property to this note first.");
    });

    it(`silently restores the native row when quiet mode cannot mount (${ISSUE})`, async () => {
      mockShowLoading.mockReturnValue(false);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
      expect(mockLogInfo).toHaveBeenCalledWith("[Tag suggestions] Could not mount the loading row");
    });

    it(`uses a fresh cached ranking in quiet mode without sending a request (${ISSUE})`, async () => {
      const cached = {
        ranked: [{ tag: "cached", score: 0.93 }],
        sourceTags: ["existing"],
      };
      mockGetCachedSuggestions.mockReturnValue(cached);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(mockCheckIsPlusUser).not.toHaveBeenCalled();
      expect(mockIsPlusEnabled).toHaveBeenCalled();
      expect(mockBroca).not.toHaveBeenCalled();
      expect(mockRowShow).toHaveBeenCalledWith(
        app.workspace.getActiveFile(),
        cached.ranked,
        expect.any(Function),
        app.workspace.getActiveViewOfType(MarkdownView),
        cached.sourceTags,
        expect.any(Function)
      );
    });

    it.each([
      "Plus is not already enabled",
      "a session is already open",
      "a request is already in flight",
    ])(`keeps the shared quiet pipeline idle when %s (${ISSUE})`, async (guard) => {
      if (guard === "Plus is not already enabled") mockIsPlusEnabled.mockReturnValue(false);
      if (guard === "a session is already open") mockHasSession.mockReturnValue(true);
      if (guard === "a request is already in flight") mockIsRequestInFlight.mockReturnValue(true);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(mockBeginRequest).not.toHaveBeenCalled();
      expect(mockShowLoading).not.toHaveBeenCalled();
      expect(mockBroca).not.toHaveBeenCalled();
    });

    it(`lets a stale live session use the shared quiet ranking pipeline (${ISSUE})`, async () => {
      mockHasSession.mockReturnValue(true);
      mockIsSessionLoading.mockReturnValue(true);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(mockBeginRequest).toHaveBeenCalledWith(app.workspace.getActiveFile());
      expect(mockBroca).toHaveBeenCalledTimes(1);
      expect(mockRowShow).toHaveBeenCalled();
    });

    it(`bypasses a cached ranking when the command explicitly requests fresh results (${ISSUE})`, async () => {
      mockGetCachedSuggestions.mockReturnValue({
        ranked: [{ tag: "cached", score: 0.93 }],
        sourceTags: ["existing"],
      });
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(mockGetCachedSuggestions).not.toHaveBeenCalled();
      expect(mockBroca).toHaveBeenCalled();
      expect(mockCacheSuggestions).toHaveBeenCalledWith(
        app.workspace.getActiveFile(),
        [{ tag: "research", score: 0.85 }],
        ["existing"]
      );
    });

    it(`discards results when the originating note is no longer active (${ISSUE})`, async () => {
      let resolveBroca: (value: Record<string, { noul: number }>) => void = () => undefined;
      mockBroca.mockImplementation(
        async () =>
          await new Promise<Record<string, { noul: number }>>((resolve) => {
            resolveBroca = resolve;
          })
      );
      const { app } = createApp();

      const pending = suggestTagsForCurrentNote(app, suggestionRow);
      await waitFor(() => expect(mockBroca).toHaveBeenCalled());
      jest
        .mocked(app.workspace.getActiveViewOfType)
        .mockReturnValue({ file: note("Projects/Other.md", 21) } as MarkdownView);
      resolveBroca({ t0: { noul: 0.85 } });
      await pending;

      expect(mockRowShow).not.toHaveBeenCalled();
    });

    it(`does not upload after the source view changes during cachedRead (${ISSUE})`, async () => {
      let resolveRead: (value: string) => void = () => undefined;
      const { app } = createApp();
      jest.mocked(app.vault.cachedRead).mockImplementation(
        async () =>
          await new Promise<string>((resolve) => {
            resolveRead = resolve;
          })
      );

      const pending = suggestTagsForCurrentNote(app, suggestionRow);
      await waitFor(() => expect(app.vault.cachedRead).toHaveBeenCalled());
      jest
        .mocked(app.workspace.getActiveViewOfType)
        .mockReturnValue({ file: note("Projects/Other.md", 21) } as MarkdownView);
      resolveRead("Active note body");
      await pending;

      expect(mockBroca).not.toHaveBeenCalled();
    });

    it(`discards an older request that finishes after a newer invocation (${ISSUE})`, async () => {
      let resolveFirst: (value: Record<string, { noul: number }>) => void = () => undefined;
      let resolveSecond: (value: Record<string, { noul: number }>) => void = () => undefined;
      mockBroca
        .mockImplementationOnce(
          async () =>
            await new Promise<Record<string, { noul: number }>>((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockImplementationOnce(
          async () =>
            await new Promise<Record<string, { noul: number }>>((resolve) => {
              resolveSecond = resolve;
            })
        );
      const { app } = createApp();

      const first = suggestTagsForCurrentNote(app, suggestionRow);
      await waitFor(() => expect(mockBroca).toHaveBeenCalledTimes(1));
      const second = suggestTagsForCurrentNote(app, suggestionRow);
      await waitFor(() => expect(mockBroca).toHaveBeenCalledTimes(2));
      resolveSecond({ t0: { noul: 0.9 } });
      await second;
      resolveFirst({ t0: { noul: 0.1 } });
      await first;

      expect(mockRowShow).toHaveBeenCalledTimes(1);
      expect(mockRowShow.mock.calls[0][1]).toEqual([{ tag: "research", score: 0.9 }]);
    });

    it("reports a failed tag write so the suggestion row can restore the pill (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      const { app } = createApp();
      jest.mocked(app.fileManager.processFrontMatter).mockRejectedValue(new Error("write failed"));
      await suggestTagsForCurrentNote(app, suggestionRow);

      await expect(updateTags?.(["research"], [])).resolves.toBe(false);

      expect(Notice).toHaveBeenCalledWith("Couldn’t add that tag. Try again.");
    });

    it("logs one entry containing only the ten suggestions shown", async () => {
      const { app } = createApp(note("Projects/Active.md", 20), 11);
      mockBroca.mockImplementation(async (_state, questions: Record<string, NoulQuestion>) =>
        Object.fromEntries(
          Object.keys(questions).map((id, index) => [id, { noul: 1 - index / 100 }])
        )
      );

      await suggestTagsForCurrentNote(app, suggestionRow);

      const suggestions = mockRowShow.mock.calls[0][1];
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

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Open a Markdown note before suggesting tags.");
    });

    it(`does not read or send the last active file from a non-file view (${ISSUE})`, async () => {
      const { app } = createApp();
      jest.mocked(app.workspace.getActiveViewOfType).mockReturnValue(null);

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(app.vault.cachedRead).not.toHaveBeenCalled();
      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Open a Markdown note before suggesting tags.");
    });

    it("does not call Jev for a Lite license below Plus (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      mockCheckIsPlusUser.mockResolvedValue(false);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(mockCheckIsPlusUser).toHaveBeenCalledWith(app, "tool_call");
      expect(app.vault.cachedRead).not.toHaveBeenCalled();
      expect(mockBroca).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "A valid Copilot Plus license is required to suggest tags."
      );
      expect(mockShowLoading).toHaveBeenCalledWith(
        app.workspace.getActiveFile(),
        app.workspace.getActiveViewOfType(MarkdownView)
      );
      expect(mockFinishRequest).toHaveBeenCalled();
    });

    it("does not call Jev when the vault has no usable candidate tags (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      const { app } = createApp();
      const active = app.workspace.getActiveFile();
      jest.mocked(app.vault.getMarkdownFiles).mockReturnValue(active ? [active] : []);

      await suggestTagsForCurrentNote(app, suggestionRow);

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

        await suggestTagsForCurrentNote(app, suggestionRow);

        expect(Notice).toHaveBeenCalledWith(expected);
        expect(mockFinishRequest).toHaveBeenCalled();
      }
    );

    it("shows the network fallback and closes the loading notice (https://github.com/Brevilabs/obsidian-copilot-private/issues/492)", async () => {
      mockBroca.mockRejectedValue(new Error("offline"));
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow);

      expect(Notice).toHaveBeenCalledWith(
        "Couldn’t suggest tags. Check your connection and try again."
      );
      expect(mockFinishRequest).toHaveBeenCalled();
    });

    it.each([
      [new BrevilabsApiError("failed", 403)],
      [new BrevilabsApiError("failed", 413)],
      [new BrevilabsApiError("failed", 429)],
      [new BrevilabsApiError("failed", 504)],
      [new Error("offline")],
    ])(`keeps quiet-mode request failures silent for %s (${ISSUE})`, async (error) => {
      mockBroca.mockRejectedValue(error);
      const { app } = createApp();

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(Notice).not.toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(mockLogError).toHaveBeenCalledWith("Tag suggestion failed", error);
    });

    it(`keeps quiet-mode empty candidates and empty rankings silent (${ISSUE})`, async () => {
      const { app } = createApp();
      const active = app.workspace.getActiveFile();
      jest.mocked(app.vault.getMarkdownFiles).mockReturnValue(active ? [active] : []);

      await suggestTagsForCurrentNote(app, suggestionRow, { quiet: true });

      expect(Notice).not.toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(mockLogInfo).toHaveBeenCalledWith("[Tag suggestions] No usable candidate tags");
    });
  });
});
