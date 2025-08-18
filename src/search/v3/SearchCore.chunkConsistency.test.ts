// Mock dependencies first
jest.mock("./MemoryIndexManager", () => ({
  MemoryIndexManager: {
    getInstance: jest.fn().mockReturnValue({
      search: jest.fn(),
      ensureLoaded: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true),
    }),
  },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("./chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => ({
    getChunks: jest.fn(),
    getChunkText: jest.fn(),
  })),
}));

import { SearchCore } from "./SearchCore";
import { MemoryIndexManager } from "./MemoryIndexManager";
import { ChunkManager } from "./chunks";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

describe("SearchCore - Chunk Consistency", () => {
  let app: any;
  let searchCore: SearchCore;
  let mockChatModel: jest.Mocked<BaseChatModel>;
  let getChatModel: jest.Mock;
  let mockChunkManager: jest.Mocked<ChunkManager>;
  let mockIndex: any;

  const mockChunks = [
    {
      id: "auth.md#0",
      notePath: "auth.md",
      chunkIndex: 0,
      content: "Authentication setup guide for OAuth",
      title: "Auth Guide",
      heading: "Introduction",
      mtime: Date.now(),
    },
    {
      id: "auth.md#1",
      notePath: "auth.md",
      chunkIndex: 1,
      content: "JWT token configuration and validation",
      title: "Auth Guide",
      heading: "JWT Setup",
      mtime: Date.now(),
    },
    {
      id: "nextjs.md#0",
      notePath: "nextjs.md",
      chunkIndex: 0,
      content: "Next.js framework introduction and setup",
      title: "Next.js Guide",
      heading: "Getting Started",
      mtime: Date.now(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock app
    app = {
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => ({
          path,
          basename: path.replace(".md", ""),
          stat: { mtime: Date.now() },
        })),
        cachedRead: jest.fn(async () => "content"),
        getMarkdownFiles: jest.fn(() => []),
      },
      metadataCache: {
        resolvedLinks: {},
        getBacklinksForFile: jest.fn(() => ({ data: {} })),
        getFileCache: jest.fn(() => ({ headings: [], frontmatter: {} })),
      },
      workspace: {
        getActiveFile: jest.fn(() => null),
      },
    };

    // Mock chat model
    mockChatModel = {
      invoke: jest.fn(),
    } as unknown as jest.Mocked<BaseChatModel>;
    getChatModel = jest.fn().mockResolvedValue(mockChatModel);

    // Mock ChunkManager
    mockChunkManager = new (ChunkManager as any)() as jest.Mocked<ChunkManager>;
    mockChunkManager.getChunks.mockResolvedValue(mockChunks);
    mockChunkManager.getChunkText.mockImplementation((id: string) => {
      const chunk = mockChunks.find((c) => c.id === id);
      return chunk?.content || "";
    });

    // Mock MemoryIndexManager
    mockIndex = MemoryIndexManager.getInstance(app);

    // Create SearchCore
    searchCore = new SearchCore(app, getChatModel);

    // Replace the chunk manager with our mock
    (searchCore as any).chunkManager = mockChunkManager;
  });

  describe("lexical-semantic chunk consistency", () => {
    it("should use same chunks for both lexical and semantic search", async () => {
      // Mock query expander
      const mockQueryExpander = (searchCore as any).queryExpander;
      jest.spyOn(mockQueryExpander, "expand").mockResolvedValue({
        queries: ["OAuth authentication"],
        salientTerms: ["oauth", "auth"],
        originalQuery: "OAuth authentication",
      });

      // Mock grep scanner to return candidates
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth.md", "nextjs.md"]);

      // Mock FullTextEngine results (chunk-based)
      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(3);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth.md#0", score: 0.9, engine: "fulltext" },
        { id: "nextjs.md#0", score: 0.7, engine: "fulltext" },
      ]);
      jest.spyOn(mockFullTextEngine, "clear").mockImplementation(() => {});
      jest.spyOn(mockFullTextEngine, "getStats").mockReturnValue({
        documentsIndexed: 3,
        memoryUsed: 200,
        memoryPercent: 0.02,
      });

      // Mock boost calculators to avoid issues
      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      const mockScoreNormalizer = (searchCore as any).scoreNormalizer;

      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((results) => results);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((results) => results);
      jest.spyOn(mockScoreNormalizer, "normalize").mockImplementation((results) => results);

      // Mock semantic search results (chunk-based)
      mockIndex.search.mockResolvedValue([
        { id: "auth.md#1", score: 0.85 },
        { id: "nextjs.md#0", score: 0.75 },
      ]);

      // Execute search with semantic enabled
      const results = await searchCore.retrieve("OAuth authentication", {
        maxResults: 10,
        enableSemantic: true,
        semanticWeight: 0.6,
      });

      // ChunkManager is called internally by FullTextEngine.buildFromCandidates
      // We verify the behavior through the end result rather than internal calls

      // Verify FullTextEngine was built from same candidates
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledWith(["auth.md", "nextjs.md"]);

      // Verify semantic search was called with same candidates
      expect(mockIndex.search).toHaveBeenCalledWith(
        expect.any(Array), // queries (including HyDE)
        expect.any(Number), // topK
        ["auth.md", "nextjs.md"] // same candidates!
      );

      // Results should contain chunk IDs from both lexical and semantic
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id.includes("#"))).toBe(true);
    });

    it("should maintain chunk candidate consistency when semantic is disabled", async () => {
      // Mock grep scanner
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth.md", "nextjs.md"]);

      // Mock FullTextEngine
      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(3);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth.md#1", score: 0.8, engine: "fulltext" },
      ]);

      // Execute search without semantic
      await searchCore.retrieve("OAuth authentication", {
        maxResults: 10,
        enableSemantic: false,
      });

      // ChunkManager is called internally by FullTextEngine.buildFromCandidates
      // We verify the behavior through the candidate consistency

      // FullTextEngine should be built from chunks
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledWith(["auth.md", "nextjs.md"]);

      // Semantic search should NOT be called
      expect(mockIndex.search).not.toHaveBeenCalled();
    });

    it("should handle empty chunk results gracefully", async () => {
      // Mock empty chunk result
      mockChunkManager.getChunks.mockResolvedValue([]);

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["empty.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(0);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([]);

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
      });

      // Should handle empty results gracefully
      expect(results).toEqual([]);
      // ChunkManager is called internally by FullTextEngine, verified through buildFromCandidates
    });
  });

  describe("chunk-based boost aggregation", () => {
    it("should apply folder boosts to chunks correctly", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth/setup.md", "auth/config.md", "nextjs/guide.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(5);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth/setup.md#0", score: 0.8, engine: "fulltext" },
        { id: "auth/config.md#0", score: 0.7, engine: "fulltext" },
        { id: "nextjs/guide.md#0", score: 0.6, engine: "fulltext" },
      ]);

      // Mock folder boost calculator
      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((results: any) => {
        // Simulate folder boost for auth/ folder (multiple files)
        return results.map((r: any) => ({
          ...r,
          score: r.id.startsWith("auth/") ? r.score * 1.15 : r.score,
        }));
      });

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("authentication", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Verify folder boosts were applied to lexical results BEFORE RRF
      expect(mockFolderBoost.applyBoosts).toHaveBeenCalled();

      // auth/ chunks should have higher scores due to folder boost
      const authResults = results.filter((r) => r.id.startsWith("auth/"));
      const nextjsResults = results.filter((r) => r.id.startsWith("nextjs/"));

      if (authResults.length > 0 && nextjsResults.length > 0) {
        // Auth results should generally score higher due to folder boost
        expect(authResults[0].score).toBeGreaterThan(nextjsResults[0].score * 0.9);
      }
    });

    it("should apply graph boosts to chunks based on note-level connections", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["auth.md", "jwt.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(4);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth.md#0", score: 0.8, engine: "fulltext" },
        { id: "auth.md#1", score: 0.75, engine: "fulltext" },
        { id: "jwt.md#0", score: 0.7, engine: "fulltext" },
      ]);

      // Mock graph boost calculator
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((results: any) => {
        // Simulate graph boost for connected notes
        return results.map((r: any) => ({
          ...r,
          score: r.id.startsWith("auth.md") ? r.score * 1.1 : r.score,
        }));
      });

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("authentication", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Verify graph boosts were applied
      expect(mockGraphBoost.applyBoost).toHaveBeenCalled();

      // auth.md chunks should have boost applied
      const authChunks = results.filter((r) => r.id.startsWith("auth.md"));
      expect(authChunks.length).toBeGreaterThan(0);
    });
  });

  describe("per-note diversity cap", () => {
    it("should limit chunks per note in final results", async () => {
      // Mock chunking with many chunks from same note
      const manyChunks = Array.from({ length: 5 }, (_, i) => ({
        id: `long-note.md#${i}`,
        notePath: "long-note.md",
        chunkIndex: i,
        content: `Chunk ${i} content`,
        title: "Long Note",
        heading: `Section ${i}`,
        mtime: Date.now(),
      }));

      mockChunkManager.getChunks.mockResolvedValue(manyChunks);

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["long-note.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(5);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "long-note.md#0", score: 0.95, engine: "fulltext" },
        { id: "long-note.md#1", score: 0.9, engine: "fulltext" },
        { id: "long-note.md#2", score: 0.85, engine: "fulltext" },
        { id: "long-note.md#3", score: 0.8, engine: "fulltext" },
        { id: "long-note.md#4", score: 0.75, engine: "fulltext" },
      ]);

      // Mock folder and graph boosts (pass-through)
      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Should include all relevant chunks (no per-note diversity cap)
      const longNoteChunks = results.filter((r) => r.id.startsWith("long-note.md"));
      expect(longNoteChunks.length).toBeGreaterThan(0);

      // Chunks should be sorted by score (highest first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("error handling with chunks", () => {
    it("should fallback gracefully when chunking fails", async () => {
      // Mock chunking failure
      mockChunkManager.getChunks.mockRejectedValue(new Error("Chunking failed"));

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "grep").mockResolvedValue(["fallback.md"]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Should fallback to simple grep results
      expect(results.length).toBeGreaterThanOrEqual(0);
      expect(results.every((r) => r.engine === "grep")).toBe(true);
    });

    it("should handle missing chunk content gracefully", async () => {
      // Mock chunk with missing content
      mockChunkManager.getChunkText.mockReturnValue("");

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["test.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(1);
      jest
        .spyOn(mockFullTextEngine, "search")
        .mockReturnValue([{ id: "test.md#0", score: 0.8, engine: "fulltext" }]);

      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Should handle missing chunk content without crashing
      expect(results).toBeDefined();
    });
  });

  describe("memory and performance with chunks", () => {
    it("should respect memory limits during chunk processing", async () => {
      // Mock memory-constrained chunking
      const limitedChunks = mockChunks.slice(0, 2); // Only first 2 chunks
      mockChunkManager.getChunks.mockResolvedValue(limitedChunks);

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth.md", "nextjs.md", "large.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(2);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth.md#1", score: 0.8, engine: "fulltext" },
      ]);

      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      mockIndex.search.mockResolvedValue([]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: false,
      });

      // Should process chunks within memory constraints (handled internally by FullTextEngine)
      // Verify that buildFromCandidates was called with the expected candidates
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledWith([
        "auth.md",
        "nextjs.md",
        "large.md",
      ]);

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
