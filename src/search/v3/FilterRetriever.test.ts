import { App, TFile } from "obsidian";
import { FilterRetriever } from "./FilterRetriever";
import { mockTFile } from "@/__tests__/mockObsidian";

// Helper: create a TFile-typed mock from a path. Uses mockTFile so `instanceof TFile`
// works for downstream code paths.
const createTFile = (path: string, stat: { mtime: number; ctime: number }): TFile => {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  return mockTFile({ path, basename, stat: { ...stat, size: 0 } });
};

// Typed accessors for mocked module exports used in tests.
const getObsidianMock = (): { getAllTags: jest.Mock } => jest.requireMock("obsidian");
const getUtilsMock = (): { extractNoteFiles: jest.Mock } => jest.requireMock("@/utils");
const getSearchUtilsMock = (): { shouldIndexFile: jest.Mock } =>
  jest.requireMock("@/search/searchUtils");

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
}));
jest.mock("@/search/searchUtils", () => ({
  isInternalExcludedFile: jest.fn().mockReturnValue(false),
  shouldIndexFile: jest.fn().mockReturnValue(true),
  getMatchingPatterns: jest.fn().mockReturnValue({ inclusions: null, exclusions: null }),
}));

describe("FilterRetriever", () => {
  let mockApp: any;

  beforeEach(() => {
    const obsidianMock = getObsidianMock();
    obsidianMock.getAllTags = jest.fn().mockReturnValue([]);

    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        cachedRead: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    };
  });

  describe("title matches", () => {
    it("should return title-matched notes with includeInContext true", async () => {
      const extractNoteFiles = jest.requireMock("@/utils").extractNoteFiles as jest.Mock;
      const mockFile = createTFile("mentioned.md", { mtime: 1000, ctime: 500 });

      extractNoteFiles.mockReturnValueOnce([mockFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Note content here");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#test" }] });

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("tell me about [[mentioned]]");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("mentioned.md");
      expect(results[0].metadata.includeInContext).toBe(true);
      expect(results[0].metadata.score).toBe(1.0);
      expect(results[0].metadata.source).toBe("title-match");
      expect(results[0].pageContent).toBe("Note content here");
    });

    it("should return empty when no [[note]] mentions in query", async () => {
      const extractNoteFiles = jest.requireMock("@/utils").extractNoteFiles as jest.Mock;
      extractNoteFiles.mockReturnValueOnce([]);

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("a plain query");
      expect(results.length).toBe(0);
    });
  });

  describe("tag matches", () => {
    it("should return tag-matched notes with includeInContext true", async () => {
      const obsidianMock = getObsidianMock();

      const taggedFile = createTFile("projects/alpha.md", { mtime: 2000, ctime: 1000 });

      mockApp.vault.getMarkdownFiles.mockReturnValue([taggedFile]);
      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file.path === "projects/alpha.md") return { tags: [{ tag: "#project" }] };
        return null;
      });
      obsidianMock.getAllTags.mockImplementation((cache: { tags?: { tag: string }[] }) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Alpha content");

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["#project"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("#project work log");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("projects/alpha.md");
      expect(results[0].metadata.includeInContext).toBe(true);
      expect(results[0].metadata.score).toBe(1.0);
      expect(results[0].metadata.source).toBe("tag-match");
    });

    it("should support hierarchical prefix matching (#project matches #project/beta)", async () => {
      const obsidianMock = getObsidianMock();

      const betaFile = createTFile("projects/beta.md", { mtime: 3000, ctime: 1000 });

      mockApp.vault.getMarkdownFiles.mockReturnValue([betaFile]);
      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file.path === "projects/beta.md") return { tags: [{ tag: "#project/beta" }] };
        return null;
      });
      obsidianMock.getAllTags.mockImplementation((cache: { tags?: { tag: string }[] }) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Beta content");

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["#project"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("#project");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("projects/beta.md");
    });

    it("should return empty when no tag terms present", async () => {
      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["keyword1", "keyword2"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("a query without tags");
      expect(results.length).toBe(0);
    });

    it("should cap tag matches at maxK when returnAll is false", async () => {
      const obsidianMock = getObsidianMock();

      // Create 10 files all matching the tag, but set maxK to 3
      const files = Array.from({ length: 10 }, (_, i) =>
        createTFile(`note${i}.md`, { mtime: 1000 + i, ctime: 500 })
      );

      mockApp.vault.getMarkdownFiles.mockReturnValue(files);
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#daily" }] });
      obsidianMock.getAllTags.mockImplementation((cache: { tags?: { tag: string }[] }) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Content");

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["#daily"],
        maxK: 3,
      });

      const results = await retriever.getRelevantDocuments("#daily");
      expect(results.length).toBe(3);
    });

    it("should use RETURN_ALL_LIMIT when returnAll is true (tag queries need expanded limits)", async () => {
      const obsidianMock = getObsidianMock();

      // Create 40 files all matching the tag, set maxK to 3 but returnAll to true
      const files = Array.from({ length: 40 }, (_, i) =>
        createTFile(`note${i}.md`, { mtime: 1000 + i, ctime: 500 })
      );

      mockApp.vault.getMarkdownFiles.mockReturnValue(files);
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#daily" }] });
      obsidianMock.getAllTags.mockImplementation((cache: { tags?: { tag: string }[] }) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Content");

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["#daily"],
        maxK: 3,
        returnAll: true,
      });

      const results = await retriever.getRelevantDocuments("#daily");
      // With returnAll: true, should get all 40 (well under RETURN_ALL_LIMIT of 100)
      expect(results.length).toBe(40);
      // And definitely more than maxK of 3
      expect(results.length).toBeGreaterThan(3);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate title and tag matches by path (title wins)", async () => {
      const obsidianMock = getObsidianMock();
      const { extractNoteFiles } = getUtilsMock();

      const sharedFile = createTFile("shared.md", { mtime: 1000, ctime: 500 });

      // File appears in both title matches and tag matches
      extractNoteFiles.mockReturnValueOnce([sharedFile]);
      mockApp.vault.getMarkdownFiles.mockReturnValue([sharedFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#tag1" }] });
      obsidianMock.getAllTags.mockImplementation((cache: { tags?: { tag: string }[] }) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Shared content");

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: ["#tag1"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("[[shared]] with #tag1");

      // Should only have 1 result (deduped), and title-match wins
      expect(results.length).toBe(1);
      expect(results[0].metadata.source).toBe("title-match");
    });
  });

  describe("time range", () => {
    it("should return time-filtered documents when timeRange is set", async () => {
      const { extractNoteFiles } = getUtilsMock();
      extractNoteFiles.mockReturnValue([]);

      const now = Date.now();
      const recentFile = createTFile("notes/recent.md", {
        mtime: now - 1000,
        ctime: now - 2000,
      });

      mockApp.vault.getMarkdownFiles.mockReturnValue([recentFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Recent content");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [] });

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
        timeRange: {
          startTime: now - 7 * 24 * 60 * 60 * 1000,
          endTime: now,
        },
      });

      const results = await retriever.getRelevantDocuments("what did I do");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("notes/recent.md");
      expect(results[0].metadata.includeInContext).toBe(true);
      expect(results[0].metadata.source).toBe("time-filtered");
    });

    it("should exclude files matching QA exclusion patterns in time-range searches", async () => {
      const { shouldIndexFile } = getSearchUtilsMock();
      const { extractNoteFiles } = getUtilsMock();
      extractNoteFiles.mockReturnValue([]);

      const now = Date.now();
      const validFile = createTFile("notes/valid.md", {
        mtime: now - 1000,
        ctime: now - 2000,
      });
      const excludedFile = createTFile("copilot/excluded.md", {
        mtime: now - 1000,
        ctime: now - 2000,
      });

      shouldIndexFile.mockImplementation((file: TFile) => !file.path.startsWith("copilot/"));
      mockApp.vault.getMarkdownFiles.mockReturnValue([validFile, excludedFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Content");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [] });

      const retriever = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
        timeRange: {
          startTime: now - 7 * 24 * 60 * 60 * 1000,
          endTime: now,
        },
        returnAll: true,
      });

      const results = await retriever.getRelevantDocuments("what did I do");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("notes/valid.md");
    });

    it("should report hasTimeRange correctly", () => {
      const withTime = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
        timeRange: { startTime: 100, endTime: 200 },
      });
      expect(withTime.hasTimeRange()).toBe(true);

      const withoutTime = new FilterRetriever(mockApp as App, {
        salientTerms: [],
        maxK: 30,
      });
      expect(withoutTime.hasTimeRange()).toBe(false);
    });
  });
});
