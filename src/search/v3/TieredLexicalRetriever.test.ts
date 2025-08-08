import { TieredLexicalRetriever } from "./TieredLexicalRetriever";
import { Document } from "@langchain/core/documents";
import { TFile } from "obsidian";
import * as SearchCoreModule from "./SearchCore";

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("./SearchCore", () => {
  return {
    SearchCore: jest.fn().mockImplementation(() => ({
      retrieve: jest.fn().mockResolvedValue([
        { id: "note1.md", score: 0.8, engine: "fulltext" },
        { id: "note2.md", score: 0.6, engine: "grep" },
      ]),
    })),
  };
});
jest.mock("@/LLMProviders/chatModelManager");

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
    jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation(() => ({
      retrieve: jest.fn().mockResolvedValue([
        { id: "note1.md", score: 0.8, engine: "fulltext" },
        { id: "note2.md", score: 0.6, engine: "grep" },
      ]),
    }));

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

    it("should integrate all components correctly", async () => {
      // Ensure SearchCore mock returns two results for this test
      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation(() => ({
        retrieve: jest.fn().mockResolvedValue([
          { id: "note1.md", score: 0.8, engine: "fulltext" },
          { id: "note2.md", score: 0.6, engine: "grep" },
        ]),
      }));

      const query = "test query";
      const results = await retriever.getRelevantDocuments(query);

      // Should return documents
      expect(results.length).toBe(2);
      expect(results[0].metadata.path).toBe("note1.md");
      expect(results[0].metadata.score).toBeGreaterThanOrEqual(0.8);
    });

    it("should handle empty search results", async () => {
      jest
        .spyOn(SearchCoreModule, "SearchCore")
        .mockImplementation(() => ({ retrieve: jest.fn().mockResolvedValue([]) }));
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

      jest.spyOn(SearchCoreModule, "SearchCore").mockImplementation(() => ({
        retrieve: jest.fn().mockResolvedValue([{ id: "other.md", score: 0.4, engine: "fulltext" }]),
      }));

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
});
