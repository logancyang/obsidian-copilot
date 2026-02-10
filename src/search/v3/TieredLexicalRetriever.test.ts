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
  });

  describe("getRelevantDocuments", () => {
    beforeEach(() => {
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

    it("should return chunk Documents from SearchCore", async () => {
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

      const results = await chunkRetriever.getRelevantDocuments("test query");

      expect(results.length).toBe(2);
      expect(results[0].metadata.path).toBe("note1.md");
      expect(results[0].metadata.chunkId).toBe("note1.md#0");
      expect(results[0].metadata.isChunk).toBe(true);
      expect(results[0].metadata.score).toBeGreaterThanOrEqual(0.8);
      expect(results[0].pageContent).toBe("First chunk content from note1");
      expect(results[0].pageContent).not.toContain("File content");
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

    it("should sort results by score descending", async () => {
      retrieveMock.mockResolvedValueOnce({
        results: [
          { id: "note2.md#0", score: 0.6, engine: "grep" },
          { id: "note1.md#0", score: 0.9, engine: "fulltext" },
        ],
        queryExpansion: {
          queries: [],
          salientTerms: [],
          originalQuery: "test",
          expandedQueries: [],
        },
      });

      const sortRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await sortRetriever.getRelevantDocuments("test");

      expect(results.length).toBe(2);
      // Higher score should come first
      expect(results[0].metadata.score).toBeGreaterThanOrEqual(results[1].metadata.score);
    });
  });

  describe("chunk Document handling", () => {
    it("should return chunk Documents with chunk content", async () => {
      const getTestChunkContent = (id: string) => {
        if (id === "test.md#0") return "First chunk from test note";
        if (id === "test.md#1") return "Second chunk from test note";
        return "";
      };
      mockChunkManager.getChunkTextSync.mockImplementation(getTestChunkContent);
      mockChunkManager.getChunkText.mockImplementation((id: string) =>
        Promise.resolve(getTestChunkContent(id))
      );

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

      expect(results.length).toBe(2);
      expect(results[0].metadata.chunkId).toBe("test.md#0");
      expect(results[0].metadata.isChunk).toBe(true);
      expect(results[0].pageContent).toBe("First chunk from test note");
    });

    it("should handle missing chunk content gracefully", async () => {
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
      expect(results.length).toBe(0);
    });
  });

  describe("multiple chunks", () => {
    it("should handle multiple chunks from same note correctly", async () => {
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

      expect(results.length).toBe(3);
      const largeNoteChunks = results.filter((r) => r.metadata.path === "large.md");
      expect(largeNoteChunks.length).toBe(2);
    });
  });
});
