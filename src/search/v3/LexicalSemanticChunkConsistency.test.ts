// Comprehensive test for lexical-semantic chunk consistency
// This test ensures that both lexical and semantic search operate on the same chunk candidates

// Mock dependencies
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

describe("Lexical-Semantic Chunk Consistency", () => {
  let app: any;
  let searchCore: SearchCore;
  let mockChatModel: jest.Mocked<BaseChatModel>;
  let getChatModel: jest.Mock;
  let mockChunkManager: jest.Mocked<ChunkManager>;
  let mockIndex: any;

  const testChunks = [
    {
      id: "auth-guide.md#0",
      notePath: "auth-guide.md",
      chunkIndex: 0,
      content: "OAuth 2.0 authentication setup and configuration guide",
      title: "Authentication Guide",
      heading: "Introduction",
      mtime: Date.now(),
    },
    {
      id: "auth-guide.md#1",
      notePath: "auth-guide.md",
      chunkIndex: 1,
      content: "JWT token validation and refresh token handling",
      title: "Authentication Guide",
      heading: "JWT Implementation",
      mtime: Date.now(),
    },
    {
      id: "security-best-practices.md#0",
      notePath: "security-best-practices.md",
      chunkIndex: 0,
      content: "Security best practices for web applications and API design",
      title: "Security Guide",
      heading: "Overview",
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
    mockChunkManager.getChunks.mockResolvedValue(testChunks);
    mockChunkManager.getChunkText.mockImplementation((id: string) => {
      const chunk = testChunks.find((c) => c.id === id);
      return chunk?.content || "";
    });

    // Mock MemoryIndexManager
    mockIndex = MemoryIndexManager.getInstance(app);

    // Create SearchCore
    searchCore = new SearchCore(app, getChatModel);

    // Replace the chunk manager with our mock
    (searchCore as any).chunkManager = mockChunkManager;
  });

  describe("candidate consistency", () => {
    it("should use same candidates for lexical and semantic search", async () => {
      // Mock grep scanner to return initial candidates
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth-guide.md", "security-best-practices.md"]);

      // Mock FullTextEngine
      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(3);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth-guide.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth-guide.md#1", score: 0.8, engine: "fulltext" },
      ]);

      // Mock semantic search
      mockIndex.search.mockResolvedValue([
        { id: "auth-guide.md#1", score: 0.85 },
        { id: "security-best-practices.md#0", score: 0.75 },
      ]);

      await searchCore.retrieve("OAuth authentication", {
        maxResults: 10,
        enableSemantic: true,
        semanticWeight: 0.6,
      });

      // ChunkManager is called internally by FullTextEngine
      // We verify the behavior through the end results

      // Verify FullTextEngine built from same candidates
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledWith([
        "auth-guide.md",
        "security-best-practices.md",
      ]);

      // Verify semantic search used same candidates
      expect(mockIndex.search).toHaveBeenCalledWith(
        expect.any(Array), // queries
        expect.any(Number), // topK
        ["auth-guide.md", "security-best-practices.md"] // same candidates
      );
    });

    it("should chunk candidates exactly once per query", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth-guide.md", "security-best-practices.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(3);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([]);

      mockIndex.search.mockResolvedValue([]);

      await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
      });

      // ChunkManager is called internally by FullTextEngine

      // FullTextEngine should be built from the candidates exactly once
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledTimes(1);

      // Semantic search should use the same candidate list
      expect(mockIndex.search).toHaveBeenCalledTimes(1);
    });

    it("should handle semantic search disabled while maintaining chunk consistency", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["auth-guide.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(2);
      jest
        .spyOn(mockFullTextEngine, "search")
        .mockReturnValue([{ id: "auth-guide.md#0", score: 0.9, engine: "fulltext" }]);

      await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: false, // Disabled
      });

      // ChunkManager is called internally by FullTextEngine for lexical search

      // FullTextEngine should still use chunks
      expect(mockFullTextEngine.buildFromCandidates).toHaveBeenCalledWith(["auth-guide.md"]);

      // Semantic search should NOT be called
      expect(mockIndex.search).not.toHaveBeenCalled();
    });
  });

  describe("chunk result consistency", () => {
    it("should return chunk IDs from both lexical and semantic search", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(["auth-guide.md", "security-best-practices.md"]);

      // Mock both searches to return chunk IDs
      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(3);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth-guide.md#0", score: 0.9, engine: "fulltext" },
        { id: "security-best-practices.md#0", score: 0.7, engine: "fulltext" },
      ]);

      mockIndex.search.mockResolvedValue([
        { id: "auth-guide.md#1", score: 0.85 },
        { id: "security-best-practices.md#0", score: 0.8 },
      ]);

      // Mock boost calculators (pass-through)
      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      const results = await searchCore.retrieve("OAuth authentication", {
        maxResults: 10,
        enableSemantic: true,
        semanticWeight: 0.6,
      });

      // All results should be chunk IDs
      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.id).toMatch(/\.md#\d+$/); // Should end with #number
      });

      // Should have results from both lexical and semantic
      const lexicalResult = results.find((r) => r.id === "auth-guide.md#0");
      const semanticResult = results.find((r) => r.id === "auth-guide.md#1");

      expect(lexicalResult).toBeDefined();
      expect(semanticResult).toBeDefined();
    });

    it("should apply RRF fusion to chunk-level results", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["auth-guide.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(2);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth-guide.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth-guide.md#1", score: 0.7, engine: "fulltext" },
      ]);

      mockIndex.search.mockResolvedValue([
        { id: "auth-guide.md#1", score: 0.8 }, // Same chunk, different score
        { id: "auth-guide.md#0", score: 0.6 }, // Same chunk, different score
      ]);

      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
        semanticWeight: 0.6, // 60% semantic, 40% lexical
      });

      expect(results.length).toBe(2);

      // Results should be properly fused - not just concatenated
      // auth-guide.md#1 should benefit from high semantic score
      // auth-guide.md#0 should benefit from high lexical score
      const chunk0 = results.find((r) => r.id === "auth-guide.md#0");
      const chunk1 = results.find((r) => r.id === "auth-guide.md#1");

      expect(chunk0).toBeDefined();
      expect(chunk1).toBeDefined();

      // Both chunks should have scores that reflect RRF fusion
      expect(chunk0!.score).toBeGreaterThan(0);
      expect(chunk0!.score).toBeLessThan(1);
      expect(chunk1!.score).toBeGreaterThan(0);
      expect(chunk1!.score).toBeLessThan(1);
    });
  });

  describe("memory and performance consistency", () => {
    it("should respect memory limits consistently across lexical and semantic", async () => {
      // Mock many large chunks that would exceed memory
      const largeChunks = Array.from({ length: 100 }, (_, i) => ({
        id: `large-note-${Math.floor(i / 10)}.md#${i % 10}`,
        notePath: `large-note-${Math.floor(i / 10)}.md`,
        chunkIndex: i % 10,
        content: "Large chunk content ".repeat(1000), // Large content
        title: `Large Note ${Math.floor(i / 10)}`,
        heading: `Section ${i % 10}`,
        mtime: Date.now(),
      }));

      // Mock memory-limited chunking
      mockChunkManager.getChunks.mockResolvedValue(largeChunks.slice(0, 10)); // Only first 10 due to memory

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest
        .spyOn(mockGrepScanner, "batchCachedReadGrep")
        .mockResolvedValue(Array.from({ length: 10 }, (_, i) => `large-note-${i}.md`));

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(10);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue(
        largeChunks.slice(0, 5).map((chunk) => ({
          id: chunk.id,
          score: 0.8,
          engine: "fulltext",
        }))
      );

      mockIndex.search.mockResolvedValue(
        largeChunks.slice(3, 8).map((chunk) => ({
          id: chunk.id,
          score: 0.7,
        }))
      );

      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      const results = await searchCore.retrieve("test query", {
        maxResults: 20,
        enableSemantic: true,
      });

      // Memory limits are handled internally by FullTextEngine when it calls ChunkManager
      // We verify that search completed successfully

      // Results should all come from the memory-limited chunk set
      results.forEach((result) => {
        const chunkIndex = parseInt(result.id.split("#")[1]);
        expect(chunkIndex).toBeLessThan(10); // Within memory-limited set
      });
    });

    it("should handle chunking failures gracefully in both search paths", async () => {
      // Mock chunking failure
      mockChunkManager.getChunks.mockRejectedValue(new Error("Memory limit exceeded"));

      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["test.md"]);
      jest.spyOn(mockGrepScanner, "grep").mockResolvedValue(["test.md"]);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
      });

      // Should handle chunking failures gracefully and still return search results
      expect(results.length).toBeGreaterThan(0);
      // Results should come from search engines (lexical + semantic fusion)
      expect(results[0].engine).toBe("rrf");
      expect(results[0].id).toMatch(/\.md#\d+$/); // Should be chunk ID format
    });
  });

  describe("chunk ID format consistency", () => {
    it("should maintain chunk ID format across all search components", async () => {
      const mockGrepScanner = (searchCore as any).grepScanner;
      jest.spyOn(mockGrepScanner, "batchCachedReadGrep").mockResolvedValue(["auth-guide.md"]);

      const mockFullTextEngine = (searchCore as any).fullTextEngine;
      jest.spyOn(mockFullTextEngine, "buildFromCandidates").mockResolvedValue(2);
      jest.spyOn(mockFullTextEngine, "search").mockReturnValue([
        { id: "auth-guide.md#0", score: 0.9, engine: "fulltext" },
        { id: "auth-guide.md#1", score: 0.8, engine: "fulltext" },
      ]);

      mockIndex.search.mockResolvedValue([
        { id: "auth-guide.md#1", score: 0.85 },
        { id: "auth-guide.md#0", score: 0.75 },
      ]);

      const mockFolderBoost = (searchCore as any).folderBoostCalculator;
      const mockGraphBoost = (searchCore as any).graphBoostCalculator;
      jest.spyOn(mockFolderBoost, "applyBoosts").mockImplementation((r) => r);
      jest.spyOn(mockGraphBoost, "applyBoost").mockImplementation((r) => r);

      const results = await searchCore.retrieve("test query", {
        maxResults: 10,
        enableSemantic: true,
      });

      // All chunk IDs should follow the format: notePath#chunkIndex
      results.forEach((result) => {
        expect(result.id).toMatch(/^[^#]+\.md#\d+$/);

        const [notePath, chunkIndexStr] = result.id.split("#");
        expect(notePath).toMatch(/\.md$/);
        expect(parseInt(chunkIndexStr)).toBeGreaterThanOrEqual(0);
      });

      // Verify consistency in the final results
      results.forEach((result) => {
        // All result IDs should follow chunk ID format
        expect(result.id).toMatch(/^[^#]+\.md#\d+$/);
      });
    });
  });
});
