import { Document } from "@langchain/core/documents";
import { TFile } from "obsidian";
import { TieredLexicalRetriever } from "./TieredLexicalRetriever";

const retrieveMock = jest.fn();

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("./SearchCore", () => ({
  SearchCore: jest.fn().mockImplementation(() => ({
    retrieve: retrieveMock,
  })),
}));
jest.mock("@/LLMProviders/chatModelManager");
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
}));
jest.mock("@/search/searchUtils", () => ({
  isInternalExcludedFile: jest.fn().mockReturnValue(false),
  shouldIndexFile: jest.fn().mockReturnValue(true),
  getMatchingPatterns: jest.fn().mockReturnValue({ inclusions: null, exclusions: null }),
}));
jest.mock("./chunks", () => {
  const mockManager = {
    getChunkTextSync: jest.fn(),
    getChunkText: jest.fn(),
  };
  return {
    ChunkManager: jest.fn().mockImplementation(() => mockManager),
    getSharedChunkManager: jest.fn().mockReturnValue(mockManager),
  };
});

describe("TieredLexicalRetriever", () => {
  let retriever: TieredLexicalRetriever;
  let mockApp: any;
  let mockChunkManager: any;

  beforeEach(() => {
    // Get reference to the mocked chunk manager
    const chunksModule = jest.requireMock("./chunks");
    mockChunkManager = chunksModule.getSharedChunkManager();

    retrieveMock.mockReset();
    // Return RetrieveResult structure with results and queryExpansion
    retrieveMock.mockResolvedValue({
      results: [
        { id: "note1.md#0", score: 0.8, engine: "fulltext" },
        { id: "note1.md#1", score: 0.7, engine: "fulltext" },
        { id: "note2.md#0", score: 0.6, engine: "grep" },
      ],
      queryExpansion: {
        queries: [],
        salientTerms: [],
        originalQuery: "",
        expandedQueries: [],
      },
    });

    // Configure both sync and async getChunkText methods
    const getChunkContent = (id: string) => {
      if (id === "note1.md#0") return "First chunk content from note1";
      if (id === "note1.md#1") return "Second chunk content from note1";
      if (id === "note2.md#0") return "Content from note2 chunk";
      return "";
    };
    mockChunkManager.getChunkTextSync.mockReset();
    mockChunkManager.getChunkTextSync.mockImplementation(getChunkContent);
    mockChunkManager.getChunkText.mockReset();
    mockChunkManager.getChunkText.mockImplementation((id: string) =>
      Promise.resolve(getChunkContent(id))
    );

    // Default getAllTags mock: return empty so getTagMatches is a no-op unless overridden
    const obsidianMock = jest.requireMock("obsidian");
    obsidianMock.getAllTags = jest.fn().mockReturnValue([]);

    // Mock app
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

    // Create retriever instance
    retriever = new TieredLexicalRetriever(mockApp, {
      minSimilarityScore: 0.1,
      maxK: 30,
      salientTerms: [], // Required field
    });
  });

  // Folder boost behavior is now implemented in FullTextEngine and covered by its tests.

  describe("combineResults", () => {
    it("should prioritize mentioned notes", () => {
      const searchDocs = [
        new Document({
          pageContent: "Search result 1",
          metadata: { path: "note1.md", score: 0.9 },
        }),
        new Document({
          pageContent: "Search result 2",
          metadata: { path: "note2.md", score: 0.8 },
        }),
      ];

      const mentionedNotes = [
        new Document({
          pageContent: "Mentioned note",
          metadata: { path: "mentioned.md", score: 0.5 },
        }),
        new Document({
          pageContent: "Duplicate note",
          metadata: { path: "note1.md", score: 0.3 }, // Lower score but mentioned
        }),
      ];

      const combined = (retriever as any).combineResults(searchDocs, mentionedNotes);

      // Should have 3 unique documents
      expect(combined.length).toBe(3);

      // Mentioned note should be included even with lower score
      const mentionedDoc = combined.find((d: Document) => d.metadata.path === "mentioned.md");
      expect(mentionedDoc).toBeDefined();

      // note1.md from mentioned notes should override search result
      const note1 = combined.find((d: Document) => d.metadata.path === "note1.md");
      expect(note1?.metadata.score).toBe(0.3); // Score from mentioned notes
    });

    it("should sort by score after folder boosting", () => {
      const searchDocs = [
        new Document({
          pageContent: "Note A",
          metadata: { path: "folder/noteA.md", score: 0.6 },
        }),
        new Document({
          pageContent: "Note B",
          metadata: { path: "folder/noteB.md", score: 0.5 },
        }),
        new Document({
          pageContent: "Note C",
          metadata: { path: "other/noteC.md", score: 0.7 },
        }),
      ];

      const combined = (retriever as any).combineResults(searchDocs, []);

      // After folder boost, folder notes might rank higher
      // Results should be sorted by score descending
      for (let i = 1; i < combined.length; i++) {
        expect(combined[i].metadata.score).toBeLessThanOrEqual(combined[i - 1].metadata.score);
      }
    });
  });

  describe("getRelevantDocuments", () => {
    beforeEach(() => {
      // nothing needed here now; SearchCore is mocked above

      // Mock file system
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "note1.md" || path === "note2.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      mockApp.vault.cachedRead.mockResolvedValue("File content");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        tags: [{ tag: "#test" }],
      });
    });

    it("should integrate all components correctly and return chunk Documents", async () => {
      retrieveMock.mockResolvedValueOnce({
        results: [
          { id: "note1.md#0", score: 0.8, engine: "fulltext" },
          { id: "note2.md#0", score: 0.6, engine: "grep" },
        ],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "test query",
          expandedQueries: [],
        },
      });

      const chunkRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const query = "test query";
      const results = await chunkRetriever.getRelevantDocuments(query);

      // Should return chunk Documents (all chunks from SearchCore, no title matches)
      expect(results.length).toBe(2);

      // First result should be chunk-based
      expect(results[0].metadata.path).toBe("note1.md");
      expect(results[0].metadata.chunkId).toBe("note1.md#0");
      expect(results[0].metadata.isChunk).toBe(true);
      expect(results[0].metadata.score).toBeGreaterThanOrEqual(0.8);
      expect(results[0].pageContent).toBe("First chunk content from note1");

      // Verify chunk content comes from ChunkManager
      expect(results[0].pageContent).not.toContain("File content"); // Not full file content
    });

    it("should handle empty search results", async () => {
      retrieveMock.mockResolvedValue({
        results: [],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "",
          expandedQueries: [],
        },
      });
      const emptyRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });
      const results = await emptyRetriever.getRelevantDocuments("no matches");
      expect(results).toEqual([]);
    });

    it("should include tag-matched notes via normal flow when salientTerms contain tags", async () => {
      const obsidianMock = jest.requireMock("obsidian");

      // A tagged file found via metadata cache
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
      mockApp.vault.cachedRead.mockImplementation((file: any) => {
        if (file.path === "projects/alpha.md") return Promise.resolve("Alpha full content");
        return Promise.resolve("Other");
      });

      // SearchCore returns a chunk from a different note
      retrieveMock.mockResolvedValueOnce({
        results: [{ id: "other.md#0", score: 0.5, engine: "fulltext" }],
        queryExpansion: {
          queries: [],
          salientTerms: ["#project"],
          originalQuery: "#project work log",
          expandedQueries: [],
        },
      });

      const otherFile = new (TFile as any)("other.md");
      Object.setPrototypeOf(otherFile, (TFile as any).prototype);
      otherFile.path = "other.md";
      otherFile.basename = "other";
      otherFile.stat = { mtime: 1000, ctime: 1000 };

      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "other.md") return otherFile;
        return null;
      });

      const getContent = (id: string) => (id === "other.md#0" ? "Other chunk" : "");
      mockChunkManager.getChunkTextSync.mockImplementation(getContent);
      mockChunkManager.getChunkText.mockImplementation((id: string) =>
        Promise.resolve(getContent(id))
      );

      const tagRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: ["#project"],
      });

      const results = await tagRetriever.getRelevantDocuments("#project work log");

      // Tag-matched note should be included as full note
      const alphaDoc = results.find((d) => d.metadata.path === "projects/alpha.md");
      expect(alphaDoc).toBeDefined();
      expect(alphaDoc!.metadata.includeInContext).toBe(true);
      expect(alphaDoc!.metadata.source).toBe("tag-match");
      expect(alphaDoc!.pageContent).toBe("Alpha full content");

      // Search result also present
      expect(results.find((d) => d.metadata.path === "other.md")).toBeDefined();
      expect(results.length).toBe(2);
    });

    it("should extract mentioned notes from query", async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "mentioned.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        if (path === "mentioned") {
          const file = new (TFile as any)("mentioned.md");
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        if (path === "note1.md" || path === "note2.md" || path === "other.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      // Mock extractNoteFiles to return the mentioned file for this test
      const { extractNoteFiles } = jest.requireMock("@/utils");
      const mockMentionedFile = {
        path: "mentioned.md",
        basename: "mentioned",
      };
      Object.setPrototypeOf(mockMentionedFile, (TFile as any).prototype);
      (mockMentionedFile as any).stat = { mtime: 1000, ctime: 1000 };
      extractNoteFiles.mockReturnValueOnce([mockMentionedFile]);

      retrieveMock.mockResolvedValueOnce({
        results: [{ id: "other.md#0", score: 0.4, engine: "fulltext" }],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "search [[mentioned]] for something",
          expandedQueries: [],
        },
      });

      const mentionRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const query = "search [[mentioned]] for something";
      const results = await mentionRetriever.getRelevantDocuments(query);

      // Should include the mentioned note
      const mentioned = results.find((d) => d.metadata.path === "mentioned.md");
      expect(mentioned).toBeDefined();
    });
  });

  describe("chunk Document handling", () => {
    it("should return chunk Documents with chunk content", async () => {
      // Update ChunkManager mock for these specific chunk IDs
      const getTestChunkContent = (id: string) => {
        if (id === "test.md#0") return "First chunk from test note";
        if (id === "test.md#1") return "Second chunk from test note";
        return "";
      };
      mockChunkManager.getChunkTextSync.mockImplementation(getTestChunkContent);
      mockChunkManager.getChunkText.mockImplementation((id: string) =>
        Promise.resolve(getTestChunkContent(id))
      );

      // Mock SearchCore before creating retriever
      retrieveMock.mockResolvedValueOnce({
        results: [
          { id: "test.md#0", score: 0.9, engine: "fulltext" },
          { id: "test.md#1", score: 0.8, engine: "fulltext" },
        ],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "test query",
          expandedQueries: [],
        },
      });

      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      const chunkRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await chunkRetriever.getRelevantDocuments("test query");

      // Should return all chunk Documents
      expect(results.length).toBe(2);
      expect(results[0].metadata.chunkId).toBe("test.md#0");
      expect(results[0].metadata.isChunk).toBe(true);
      expect(results[0].pageContent).toBe("First chunk from test note");
    });

    it("should handle missing chunk content gracefully", async () => {
      // Mock ChunkManager to return empty content
      mockChunkManager.getChunkTextSync.mockImplementation(() => "");
      mockChunkManager.getChunkText.mockImplementation(() => Promise.resolve(""));

      retrieveMock.mockResolvedValueOnce({
        results: [{ id: "test.md#0", score: 0.9, engine: "fulltext" }],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "test query",
          expandedQueries: [],
        },
      });

      const emptyChunkRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await emptyChunkRetriever.getRelevantDocuments("test query");

      // Should skip chunks with empty content
      expect(results.length).toBe(0);
    });
  });

  describe("multiple chunks", () => {
    it("should handle multiple chunks from same note correctly", async () => {
      // Mock file system
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "large.md" || path === "other.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      retrieveMock.mockResolvedValueOnce({
        results: [
          { id: "large.md#0", score: 0.9, engine: "fulltext" },
          { id: "large.md#1", score: 0.8, engine: "fulltext" },
          { id: "other.md#0", score: 0.6, engine: "fulltext" },
        ],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "test query",
          expandedQueries: [],
        },
      });

      const getMultiChunkContent = (id: string) => {
        if (id === "large.md#0") return "First chunk from large note";
        if (id === "large.md#1") return "Second chunk from large note";
        if (id === "other.md#0") return "Content from other note";
        return "";
      };
      mockChunkManager.getChunkTextSync.mockImplementation(getMultiChunkContent);
      mockChunkManager.getChunkText.mockImplementation((id: string) =>
        Promise.resolve(getMultiChunkContent(id))
      );

      const multiChunkRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await multiChunkRetriever.getRelevantDocuments("test query");

      // Should return all chunks
      expect(results.length).toBe(3);
      const largeNoteChunks = results.filter((r) => r.metadata.path === "large.md");
      expect(largeNoteChunks.length).toBe(2);
    });
  });

  describe("tag match injection", () => {
    it("should include all tag-matched files as full notes in results", async () => {
      const obsidianMock = jest.requireMock("obsidian");
      const mockedGetAllTags = obsidianMock.getAllTags as jest.Mock;

      // Create mock files with tags
      const taggedFile1 = new (TFile as any)("projects/alpha.md");
      Object.setPrototypeOf(taggedFile1, (TFile as any).prototype);
      taggedFile1.path = "projects/alpha.md";
      taggedFile1.basename = "alpha";
      taggedFile1.stat = { mtime: 2000, ctime: 1000 };

      const taggedFile2 = new (TFile as any)("projects/beta.md");
      Object.setPrototypeOf(taggedFile2, (TFile as any).prototype);
      taggedFile2.path = "projects/beta.md";
      taggedFile2.basename = "beta";
      taggedFile2.stat = { mtime: 3000, ctime: 1000 };

      const untaggedFile = new (TFile as any)("notes/unrelated.md");
      Object.setPrototypeOf(untaggedFile, (TFile as any).prototype);
      untaggedFile.path = "notes/unrelated.md";
      untaggedFile.basename = "unrelated";
      untaggedFile.stat = { mtime: 1000, ctime: 1000 };

      // Mock vault.getMarkdownFiles
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([taggedFile1, taggedFile2, untaggedFile]);

      // Mock metadataCache to return caches with tags
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "projects/alpha.md") return { tags: [{ tag: "#project" }] };
        if (file.path === "projects/beta.md") return { tags: [{ tag: "#project/beta" }] };
        if (file.path === "notes/unrelated.md") return { tags: [{ tag: "#random" }] };
        return null;
      });

      // Mock getAllTags to return tags from the cache
      mockedGetAllTags.mockImplementation((cache: any) => {
        if (!cache?.tags) return [];
        return cache.tags.map((t: any) => t.tag);
      });

      // Mock cachedRead to return distinct content per file
      mockApp.vault.cachedRead.mockImplementation((file: any) => {
        if (file.path === "projects/alpha.md") return Promise.resolve("Alpha project full content");
        if (file.path === "projects/beta.md") return Promise.resolve("Beta project full content");
        return Promise.resolve("Other content");
      });

      // SearchCore returns a chunk result from an unrelated note
      retrieveMock.mockResolvedValueOnce({
        results: [{ id: "notes/unrelated.md#0", score: 0.5, engine: "fulltext" }],
        queryExpansion: {
          queries: [],
          salientTerms: ["#project"],
          originalQuery: "#project",
          expandedQueries: [],
        },
      });

      const getUnrelatedChunk = (id: string) => {
        if (id === "notes/unrelated.md#0") return "Unrelated chunk content";
        return "";
      };
      mockChunkManager.getChunkTextSync.mockImplementation(getUnrelatedChunk);
      mockChunkManager.getChunkText.mockImplementation((id: string) =>
        Promise.resolve(getUnrelatedChunk(id))
      );

      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "notes/unrelated.md") return untaggedFile;
        return null;
      });

      const tagRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: ["#project"],
      });

      const results = await tagRetriever.getRelevantDocuments("give me notes on #project");

      // Both tagged files should be present as full notes
      const alphaDoc = results.find((d) => d.metadata.path === "projects/alpha.md");
      const betaDoc = results.find((d) => d.metadata.path === "projects/beta.md");

      expect(alphaDoc).toBeDefined();
      expect(alphaDoc!.metadata.includeInContext).toBe(true);
      expect(alphaDoc!.metadata.score).toBe(1.0);
      expect(alphaDoc!.metadata.source).toBe("tag-match");
      expect(alphaDoc!.pageContent).toBe("Alpha project full content");

      // #project/beta matches via hierarchical prefix (#project matches #project/beta)
      expect(betaDoc).toBeDefined();
      expect(betaDoc!.metadata.includeInContext).toBe(true);
      expect(betaDoc!.pageContent).toBe("Beta project full content");

      // Unrelated note should also be in results (from search)
      const unrelatedDoc = results.find((d) => d.metadata.path === "notes/unrelated.md");
      expect(unrelatedDoc).toBeDefined();

      // Total: 2 tag matches + 1 search result
      expect(results.length).toBe(3);
    });
  });

  describe("time range search with QA exclusions", () => {
    it("should exclude files matching QA exclusion patterns in time-range searches", async () => {
      const { shouldIndexFile } = jest.requireMock("@/search/searchUtils");

      // Create mock files - some in excluded folder, some not
      const now = Date.now();
      const mockFiles = [
        {
          path: "notes/valid-note.md",
          basename: "valid-note",
          stat: { mtime: now - 1000, ctime: now - 2000 },
        },
        {
          path: "copilot/custom-prompt.md",
          basename: "custom-prompt",
          stat: { mtime: now - 1000, ctime: now - 2000 },
        },
        {
          path: "notes/another-note.md",
          basename: "another-note",
          stat: { mtime: now - 1000, ctime: now - 2000 },
        },
      ];

      // Add TFile prototype to mock files
      mockFiles.forEach((f) => {
        Object.setPrototypeOf(f, (TFile as any).prototype);
      });

      // Mock shouldIndexFile to exclude files in copilot/ folder
      shouldIndexFile.mockImplementation((file: any) => {
        return !file.path.startsWith("copilot/");
      });

      // Mock vault.getMarkdownFiles to return all files
      mockApp.vault.getMarkdownFiles = jest.fn().mockReturnValue(mockFiles);
      mockApp.vault.cachedRead.mockResolvedValue("File content");
      mockApp.metadataCache.getFileCache.mockReturnValue({ tags: [] });

      // Mock extractNoteFiles to return empty (no daily notes found)
      const { extractNoteFiles } = jest.requireMock("@/utils");
      extractNoteFiles.mockReturnValue([]);

      // Create retriever with time range
      const timeRangeRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
        timeRange: {
          startTime: now - 7 * 24 * 60 * 60 * 1000, // 7 days ago
          endTime: now,
        },
        returnAll: true,
      });

      const results = await timeRangeRetriever.getRelevantDocuments("what did I do");

      // Should only include files not in excluded folder
      expect(results.length).toBe(2);
      expect(results.every((r) => !r.metadata.path.startsWith("copilot/"))).toBe(true);
      expect(results.some((r) => r.metadata.path === "notes/valid-note.md")).toBe(true);
      expect(results.some((r) => r.metadata.path === "notes/another-note.md")).toBe(true);

      // Verify shouldIndexFile was called for filtering
      expect(shouldIndexFile).toHaveBeenCalled();
    });
  });
});
