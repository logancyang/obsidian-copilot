import { Document } from "@langchain/core/documents";
import { TFile } from "obsidian";
import * as SearchCoreModule from "./SearchCore";
import { TieredLexicalRetriever } from "./TieredLexicalRetriever";

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("./SearchCore", () => {
  const mockChunkManager = {
    getChunkText: jest.fn((id: string) => {
      if (id === "note1.md#0") return "First chunk content from note1";
      if (id === "note1.md#1") return "Second chunk content from note1";
      if (id === "note2.md#0") return "Content from note2 chunk";
      return "";
    }),
  };

  return {
    SearchCore: jest.fn().mockImplementation(() => ({
      retrieve: jest.fn().mockResolvedValue([
        { id: "note1.md#0", score: 0.8, engine: "fulltext" },
        { id: "note1.md#1", score: 0.7, engine: "fulltext" },
        { id: "note2.md#0", score: 0.6, engine: "grep" },
      ]),
      getChunkManager: jest.fn(() => mockChunkManager),
    })),
  };
});
jest.mock("@/LLMProviders/chatModelManager");
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
}));
jest.mock("./chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => ({
    getChunkText: jest.fn((id: string) => {
      if (id === "note1.md#0") return "First chunk content from note1";
      if (id === "note1.md#1") return "Second chunk content from note1";
      if (id === "note2.md#0") return "Content from note2 chunk";
      return "";
    }),
  })),
}));

describe("TieredLexicalRetriever", () => {
  let retriever: TieredLexicalRetriever;
  let mockApp: any;
  // legacy var no longer used after refactor

  beforeEach(() => {
    // Mock app
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        cachedRead: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    };

    // Ensure SearchCore is mocked before constructing retriever
    jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
      retrieve: jest.fn().mockResolvedValue([
        { id: "note1.md#0", score: 0.8, engine: "fulltext" },
        { id: "note1.md#1", score: 0.7, engine: "fulltext" },
        { id: "note2.md#0", score: 0.6, engine: "grep" },
      ]),
    })) as any);

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
      // Ensure SearchCore mock returns chunk results
      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest.fn().mockResolvedValue([
          { id: "note1.md#0", score: 0.8, engine: "fulltext" },
          { id: "note2.md#0", score: 0.6, engine: "grep" },
        ]),
      })) as any);

      // Recreate retriever with the mocked SearchCore
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const query = "test query";
      const results = await retriever.getRelevantDocuments(query);

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
      jest
        .spyOn(SearchCoreModule, "SearchCore")
        .mockImplementation((() => ({ retrieve: jest.fn().mockResolvedValue([]) })) as any);
      // Recreate retriever to use the new mock implementation
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });
      const results = await retriever.getRelevantDocuments("no matches");
      expect(results).toEqual([]);
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

      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest
          .fn()
          .mockResolvedValue([{ id: "other.md#0", score: 0.4, engine: "fulltext" }]),
      })) as any);

      // Recreate retriever to use the new mock implementation
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const query = "search [[mentioned]] for something";
      const results = await retriever.getRelevantDocuments(query);

      // Should include the mentioned note
      const mentioned = results.find((d) => d.metadata.path === "mentioned.md");
      expect(mentioned).toBeDefined();
    });
  });

  describe("chunk Document handling", () => {
    beforeEach(() => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "test.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      mockApp.vault.cachedRead.mockResolvedValue("Full file content");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        tags: [{ tag: "#test" }],
      });
    });

    it("should return chunk Documents with chunk content", async () => {
      // Update ChunkManager mock for these specific chunk IDs
      const { ChunkManager } = jest.requireMock("./chunks");
      ChunkManager.mockImplementation(() => ({
        getChunkText: jest.fn((id: string) => {
          if (id === "test.md#0") return "First chunk from test note";
          if (id === "test.md#1") return "Second chunk from test note";
          return "";
        }),
      }));

      // Mock SearchCore before creating retriever
      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest.fn().mockResolvedValue([
          { id: "test.md#0", score: 0.9, engine: "fulltext" },
          { id: "test.md#1", score: 0.8, engine: "fulltext" },
        ]),
      })) as any);

      // Recreate retriever with the mocked SearchCore
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await retriever.getRelevantDocuments("test query");

      // Should return all chunk Documents (no diversity cap)
      expect(results.length).toBe(2);

      // First chunk
      expect(results[0].metadata.chunkId).toBe("test.md#0");
      expect(results[0].metadata.isChunk).toBe(true);
      expect(results[0].pageContent).toBe("First chunk from test note"); // From ChunkManager mock

      // Second chunk
      expect(results[1].metadata.chunkId).toBe("test.md#1");
      expect(results[1].metadata.isChunk).toBe(true);
      expect(results[1].pageContent).toBe("Second chunk from test note");
    });

    it("should handle legacy note IDs (without #) as full notes", async () => {
      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest.fn().mockResolvedValue([
          { id: "test.md", score: 0.9, engine: "fulltext" }, // Legacy note ID
        ]),
      })) as any);

      // Recreate retriever
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await retriever.getRelevantDocuments("test query");

      expect(results.length).toBe(1);
      expect(results[0].metadata.path).toBe("test.md");
      expect(results[0].metadata.isChunk).toBe(false);
      expect(results[0].pageContent).toBe("Full file content"); // Full note content
    });

    it("should handle missing chunk content gracefully", async () => {
      // Mock ChunkManager to return empty content
      const { ChunkManager: mockChunkManager } = jest.requireMock("./chunks");
      mockChunkManager.mockImplementation(() => ({
        getChunkText: jest.fn(() => ""), // Empty chunk content
      }));

      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest
          .fn()
          .mockResolvedValue([{ id: "test.md#0", score: 0.9, engine: "fulltext" }]),
      })) as any);

      // Recreate retriever to use new mock
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await retriever.getRelevantDocuments("test query");

      // Should skip chunks with empty content
      expect(results.length).toBe(0);
    });

    it("should combine chunk results with title matches properly", async () => {
      // Update ChunkManager mock for test.md chunks
      const { ChunkManager } = jest.requireMock("./chunks");
      ChunkManager.mockImplementation(() => ({
        getChunkText: jest.fn((id: string) => {
          if (id === "test.md#0") return "Content from test chunk";
          return "";
        }),
      }));

      // Mock extractNoteFiles to return a title match for this test
      const { extractNoteFiles } = jest.requireMock("@/utils");
      const mockTitleFile = {
        path: "title.md",
        basename: "title",
      };
      Object.setPrototypeOf(mockTitleFile, (TFile as any).prototype);
      (mockTitleFile as any).stat = { mtime: 1000, ctime: 1000 };
      extractNoteFiles.mockReturnValueOnce([mockTitleFile]);

      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest
          .fn()
          .mockResolvedValue([{ id: "test.md#0", score: 0.7, engine: "fulltext" }]),
      })) as any);

      // Recreate retriever with the mocked SearchCore
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      // Query with mentioned note
      const results = await retriever.getRelevantDocuments("test [[title]] query");

      // Should have both search result chunk and title match note
      expect(results.length).toBe(2);

      // Find the chunk result
      const chunkResult = results.find((r) => r.metadata.chunkId === "test.md#0");
      expect(chunkResult).toBeDefined();
      expect(chunkResult!.metadata.isChunk).toBe(true);

      // Find the title match result (full note)
      const titleResult = results.find((r) => r.metadata.path === "title.md");
      expect(titleResult).toBeDefined();
      expect(titleResult!.metadata.source).toBe("title-match");
      expect(titleResult!.pageContent).toBe("Full file content");
    });
  });

  describe("per-note diversity in combination", () => {
    it("should handle multiple chunks from same note correctly", async () => {
      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation((() => ({
        retrieve: jest.fn().mockResolvedValue([
          { id: "large.md#0", score: 0.9, engine: "fulltext" },
          { id: "large.md#1", score: 0.8, engine: "fulltext" },
          { id: "large.md#2", score: 0.7, engine: "fulltext" },
          { id: "other.md#0", score: 0.6, engine: "fulltext" },
        ]),
      })) as any);

      // Mock file system for large.md
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "large.md" || path === "other.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      // Update ChunkManager mock for these chunk IDs
      const { ChunkManager: mockChunkManager } = jest.requireMock("./chunks");
      mockChunkManager.mockImplementation(() => ({
        getChunkText: jest.fn((id: string) => {
          if (id === "large.md#0") return "First chunk from large note";
          if (id === "large.md#1") return "Second chunk from large note";
          if (id === "large.md#2") return "Third chunk from large note";
          if (id === "other.md#0") return "Content from other note";
          return "";
        }),
      }));

      // Recreate retriever with the mocked SearchCore
      retriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });

      const results = await retriever.getRelevantDocuments("test query");

      // Should return all chunks (no diversity cap anymore)
      expect(results.length).toBe(4);

      // Verify all chunk results are properly formed
      const largeNoteChunks = results.filter((r) => r.metadata.path === "large.md");
      expect(largeNoteChunks.length).toBe(3);

      largeNoteChunks.forEach((chunk) => {
        expect(chunk.metadata.isChunk).toBe(true);
        expect(chunk.pageContent).toContain("chunk from large note");
      });
    });
  });
});
