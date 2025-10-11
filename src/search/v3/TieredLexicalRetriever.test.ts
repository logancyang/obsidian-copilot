import { Document } from "@langchain/core/documents";
import { TFile } from "obsidian";
import { TieredLexicalRetriever } from "./TieredLexicalRetriever";

const retrieveMock = jest.fn();
const mockChunkManager: { getChunkTextSync: jest.Mock } = {
  getChunkTextSync: jest.fn(),
};

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("./SearchCore", () => ({
  SearchCore: jest.fn().mockImplementation(() => ({
    retrieve: retrieveMock,
    getChunkManager: jest.fn(() => mockChunkManager),
  })),
}));
jest.mock("@/LLMProviders/chatModelManager");
jest.mock("@/utils", () => ({
  extractNoteFiles: jest.fn().mockReturnValue([]),
}));
jest.mock("./chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => mockChunkManager),
}));

describe("TieredLexicalRetriever", () => {
  let retriever: TieredLexicalRetriever;
  let mockApp: any;
  // legacy var no longer used after refactor

  beforeEach(() => {
    retrieveMock.mockReset();
    retrieveMock.mockResolvedValue([
      { id: "note1.md#0", score: 0.8, engine: "fulltext" },
      { id: "note1.md#1", score: 0.7, engine: "fulltext" },
      { id: "note2.md#0", score: 0.6, engine: "grep" },
    ]);

    mockChunkManager.getChunkTextSync.mockReset();
    mockChunkManager.getChunkTextSync.mockImplementation((id: string) => {
      if (id === "note1.md#0") return "First chunk content from note1";
      if (id === "note1.md#1") return "Second chunk content from note1";
      if (id === "note2.md#0") return "Content from note2 chunk";
      return "";
    });

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
      retrieveMock.mockResolvedValueOnce([
        { id: "note1.md#0", score: 0.8, engine: "fulltext" },
        { id: "note2.md#0", score: 0.6, engine: "grep" },
      ]);

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
      retrieveMock.mockResolvedValue([]);
      const emptyRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: 30,
        salientTerms: [],
      });
      const results = await emptyRetriever.getRelevantDocuments("no matches");
      expect(results).toEqual([]);
    });

    it("should retrieve all tag matches when returnAllTags is enabled", async () => {
      retrieveMock.mockResolvedValue([
        { id: "tagNote.md#0", score: 0.9, engine: "fulltext" },
        { id: "tagNote.md#1", score: 0.8, engine: "fulltext" },
      ]);

      const tagRetrieverOptions: ConstructorParameters<typeof TieredLexicalRetriever>[1] = {
        minSimilarityScore: 0.1,
        maxK: Number.MAX_SAFE_INTEGER,
        salientTerms: ["#project"],
        returnAllTags: true,
        tagTerms: ["#project"],
      };

      const tagRetriever = new TieredLexicalRetriever(mockApp, tagRetrieverOptions);

      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "tagNote.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      mockChunkManager.getChunkTextSync.mockImplementation((id: string) => {
        if (id === "tagNote.md#0") return "Tag chunk 0";
        if (id === "tagNote.md#1") return "Tag chunk 1";
        return "";
      });

      const results = await tagRetriever.getRelevantDocuments("#project work log");

      expect(retrieveMock).toHaveBeenCalledWith(
        expect.stringContaining("#project"),
        expect.objectContaining({
          returnAll: true,
          salientTerms: ["#project"],
        })
      );
      expect(results.length).toBe(2);
    });

    it("should derive tag terms from query when returnAllTags is set without explicit tags", async () => {
      retrieveMock.mockResolvedValue([
        { id: "tagNote.md#0", score: 0.9, engine: "fulltext" },
        { id: "tagNote.md#1", score: 0.8, engine: "fulltext" },
      ]);

      const derivedRetriever = new TieredLexicalRetriever(mockApp, {
        minSimilarityScore: 0.1,
        maxK: Number.MAX_SAFE_INTEGER,
        salientTerms: [],
        returnAllTags: true,
      });

      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "tagNote.md") {
          const file = new (TFile as any)(path);
          Object.setPrototypeOf(file, (TFile as any).prototype);
          (file as any).stat = { mtime: 1000, ctime: 1000 };
          return file;
        }
        return null;
      });

      mockChunkManager.getChunkTextSync.mockImplementation((id: string) => {
        if (id === "tagNote.md#0") return "Tag chunk 0";
        if (id === "tagNote.md#1") return "Tag chunk 1";
        return "";
      });

      const results = await derivedRetriever.getRelevantDocuments("#PROJECT planning");

      expect(retrieveMock).toHaveBeenCalledWith(
        expect.stringContaining("#project"),
        expect.objectContaining({
          returnAll: true,
          salientTerms: ["#project"],
        })
      );
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

      retrieveMock.mockResolvedValueOnce([{ id: "other.md#0", score: 0.4, engine: "fulltext" }]);

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
      mockChunkManager.getChunkTextSync.mockImplementation((id: string) => {
        if (id === "test.md#0") return "First chunk from test note";
        if (id === "test.md#1") return "Second chunk from test note";
        return "";
      });

      // Mock SearchCore before creating retriever
      retrieveMock.mockResolvedValueOnce([
        { id: "test.md#0", score: 0.9, engine: "fulltext" },
        { id: "test.md#1", score: 0.8, engine: "fulltext" },
      ]);

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

      retrieveMock.mockResolvedValueOnce([{ id: "test.md#0", score: 0.9, engine: "fulltext" }]);

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

      retrieveMock.mockResolvedValueOnce([
        { id: "large.md#0", score: 0.9, engine: "fulltext" },
        { id: "large.md#1", score: 0.8, engine: "fulltext" },
        { id: "other.md#0", score: 0.6, engine: "fulltext" },
      ]);

      mockChunkManager.getChunkTextSync.mockImplementation((id: string) => {
        if (id === "large.md#0") return "First chunk from large note";
        if (id === "large.md#1") return "Second chunk from large note";
        if (id === "other.md#0") return "Content from other note";
        return "";
      });

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
});
