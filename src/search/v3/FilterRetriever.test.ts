import { TFile } from "obsidian";
import { FilterRetriever } from "./FilterRetriever";

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
    const obsidianMock = jest.requireMock("obsidian");
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
      const { extractNoteFiles } = jest.requireMock("@/utils");
      const mockFile = new (TFile as any)("mentioned.md");
      Object.setPrototypeOf(mockFile, (TFile as any).prototype);
      mockFile.path = "mentioned.md";
      mockFile.basename = "mentioned";
      mockFile.stat = { mtime: 1000, ctime: 500 };

      extractNoteFiles.mockReturnValueOnce([mockFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Note content here");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#test" }] });

      const retriever = new FilterRetriever(mockApp, {
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
      const { extractNoteFiles } = jest.requireMock("@/utils");
      extractNoteFiles.mockReturnValueOnce([]);

      const retriever = new FilterRetriever(mockApp, {
        salientTerms: [],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("a plain query");
      expect(results.length).toBe(0);
    });
  });

  describe("tag matches", () => {
    it("should return tag-matched notes with includeInContext true", async () => {
      const obsidianMock = jest.requireMock("obsidian");

      const taggedFile = new (TFile as any)("projects/alpha.md");
      Object.setPrototypeOf(taggedFile, (TFile as any).prototype);
      taggedFile.path = "projects/alpha.md";
      taggedFile.basename = "alpha";
      taggedFile.stat = { mtime: 2000, ctime: 1000 };

      mockApp.vault.getMarkdownFiles.mockReturnValue([taggedFile]);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "projects/alpha.md") return { tags: [{ tag: "#project" }] };
        return null;
      });
      obsidianMock.getAllTags.mockImplementation((cache: any) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t: any) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Alpha content");

      const retriever = new FilterRetriever(mockApp, {
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
      const obsidianMock = jest.requireMock("obsidian");

      const betaFile = new (TFile as any)("projects/beta.md");
      Object.setPrototypeOf(betaFile, (TFile as any).prototype);
      betaFile.path = "projects/beta.md";
      betaFile.basename = "beta";
      betaFile.stat = { mtime: 3000, ctime: 1000 };

      mockApp.vault.getMarkdownFiles.mockReturnValue([betaFile]);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "projects/beta.md") return { tags: [{ tag: "#project/beta" }] };
        return null;
      });
      obsidianMock.getAllTags.mockImplementation((cache: any) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t: any) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Beta content");

      const retriever = new FilterRetriever(mockApp, {
        salientTerms: ["#project"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("#project");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("projects/beta.md");
    });

    it("should return empty when no tag terms present", async () => {
      const retriever = new FilterRetriever(mockApp, {
        salientTerms: ["keyword1", "keyword2"],
        maxK: 30,
      });

      const results = await retriever.getRelevantDocuments("a query without tags");
      expect(results.length).toBe(0);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate title and tag matches by path (title wins)", async () => {
      const obsidianMock = jest.requireMock("obsidian");
      const { extractNoteFiles } = jest.requireMock("@/utils");

      const sharedFile = new (TFile as any)("shared.md");
      Object.setPrototypeOf(sharedFile, (TFile as any).prototype);
      sharedFile.path = "shared.md";
      sharedFile.basename = "shared";
      sharedFile.stat = { mtime: 1000, ctime: 500 };

      // File appears in both title matches and tag matches
      extractNoteFiles.mockReturnValueOnce([sharedFile]);
      mockApp.vault.getMarkdownFiles.mockReturnValue([sharedFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: "#tag1" }] });
      obsidianMock.getAllTags.mockImplementation((cache: any) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t: any) => t.tag);
      });
      mockApp.vault.cachedRead.mockResolvedValue("Shared content");

      const retriever = new FilterRetriever(mockApp, {
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
      const { extractNoteFiles } = jest.requireMock("@/utils");
      extractNoteFiles.mockReturnValue([]);

      const now = Date.now();
      const recentFile = {
        path: "notes/recent.md",
        basename: "recent",
        stat: { mtime: now - 1000, ctime: now - 2000 },
      };
      Object.setPrototypeOf(recentFile, (TFile as any).prototype);

      mockApp.vault.getMarkdownFiles.mockReturnValue([recentFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Recent content");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [] });

      const retriever = new FilterRetriever(mockApp, {
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
      const { shouldIndexFile } = jest.requireMock("@/search/searchUtils");
      const { extractNoteFiles } = jest.requireMock("@/utils");
      extractNoteFiles.mockReturnValue([]);

      const now = Date.now();
      const validFile = {
        path: "notes/valid.md",
        basename: "valid",
        stat: { mtime: now - 1000, ctime: now - 2000 },
      };
      const excludedFile = {
        path: "copilot/excluded.md",
        basename: "excluded",
        stat: { mtime: now - 1000, ctime: now - 2000 },
      };
      [validFile, excludedFile].forEach((f) => Object.setPrototypeOf(f, (TFile as any).prototype));

      shouldIndexFile.mockImplementation((file: any) => !file.path.startsWith("copilot/"));
      mockApp.vault.getMarkdownFiles.mockReturnValue([validFile, excludedFile]);
      mockApp.vault.cachedRead.mockResolvedValue("Content");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [] });

      const retriever = new FilterRetriever(mockApp, {
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
      const withTime = new FilterRetriever(mockApp, {
        salientTerms: [],
        maxK: 30,
        timeRange: { startTime: 100, endTime: 200 },
      });
      expect(withTime.hasTimeRange()).toBe(true);

      const withoutTime = new FilterRetriever(mockApp, {
        salientTerms: [],
        maxK: 30,
      });
      expect(withoutTime.hasTimeRange()).toBe(false);
    });
  });
});
