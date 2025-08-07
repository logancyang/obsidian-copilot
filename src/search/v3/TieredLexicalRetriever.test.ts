import { TieredLexicalRetriever } from "./TieredLexicalRetriever";
import { Document } from "@langchain/core/documents";

// Mock modules
jest.mock("obsidian");
jest.mock("@/logger");
jest.mock("./SearchCore");
jest.mock("@/LLMProviders/chatModelManager");

describe("TieredLexicalRetriever", () => {
  let retriever: TieredLexicalRetriever;
  let mockApp: any;
  let mockTieredRetriever: any;

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

    // Create retriever instance
    retriever = new TieredLexicalRetriever(mockApp, {
      minSimilarityScore: 0.1,
      maxK: 30,
      salientTerms: [], // Required field
    });

    // Mock TieredRetriever
    mockTieredRetriever = {
      search: jest.fn(),
    };
    (retriever as any).tieredRetriever = mockTieredRetriever;
  });

  describe("applyFolderBoost", () => {
    it("should boost notes in the same folder", () => {
      const documents: Document[] = [
        new Document({
          pageContent: "Lesson 1 content",
          metadata: { path: "Piano Lessons/Lesson 1.md", score: 0.8 },
        }),
        new Document({
          pageContent: "Lesson 2 content",
          metadata: { path: "Piano Lessons/Lesson 2.md", score: 0.6 },
        }),
        new Document({
          pageContent: "Daily note",
          metadata: { path: "daily/2024-01-01.md", score: 0.7 },
        }),
        new Document({
          pageContent: "Lesson 3 content",
          metadata: { path: "Piano Lessons/Lesson 3.md", score: 0.5 },
        }),
      ];

      // Apply folder boost
      (retriever as any).applyFolderBoost(documents);

      // Piano Lessons folder has 3 notes, should get boosted
      const lesson1 = documents[0];
      const lesson2 = documents[1];
      const lesson3 = documents[3];
      const daily = documents[2];

      // Check that Piano Lessons notes got boosted
      expect(lesson1.metadata.score).toBeGreaterThan(0.8);
      expect(lesson2.metadata.score).toBeGreaterThan(0.6);
      expect(lesson3.metadata.score).toBeGreaterThan(0.5);

      // Daily note should not be boosted (only 1 in its folder)
      expect(daily.metadata.score).toBe(0.7);

      // Check boost factor is set
      expect(lesson1.metadata.folderBoost).toBeDefined();
      expect(lesson1.metadata.folderBoost).toBeGreaterThan(1);
      expect(daily.metadata.folderBoost).toBeUndefined();
    });

    it("should apply proportional boost based on folder prevalence", () => {
      const documents: Document[] = [
        new Document({
          pageContent: "Note 1",
          metadata: { path: "folder1/note1.md", score: 1.0 },
        }),
        new Document({
          pageContent: "Note 2",
          metadata: { path: "folder1/note2.md", score: 1.0 },
        }),
        new Document({
          pageContent: "Note 3",
          metadata: { path: "folder2/note3.md", score: 1.0 },
        }),
        new Document({
          pageContent: "Note 4",
          metadata: { path: "folder2/note4.md", score: 1.0 },
        }),
        new Document({
          pageContent: "Note 5",
          metadata: { path: "folder2/note5.md", score: 1.0 },
        }),
        new Document({
          pageContent: "Note 6",
          metadata: { path: "folder2/note6.md", score: 1.0 },
        }),
      ];

      (retriever as any).applyFolderBoost(documents);

      // folder1 has 2 notes, folder2 has 4 notes
      const folder1Notes = documents.filter((d) => d.metadata.path.startsWith("folder1"));
      const folder2Notes = documents.filter((d) => d.metadata.path.startsWith("folder2"));

      // folder2 should have higher boost factor (more notes)
      const folder1Boost = folder1Notes[0].metadata.folderBoost;
      const folder2Boost = folder2Notes[0].metadata.folderBoost;

      expect(folder2Boost).toBeGreaterThan(folder1Boost);
    });

    it("should not boost notes without folder structure", () => {
      const documents: Document[] = [
        new Document({
          pageContent: "Root note 1",
          metadata: { path: "note1.md", score: 0.8 },
        }),
        new Document({
          pageContent: "Root note 2",
          metadata: { path: "note2.md", score: 0.7 },
        }),
      ];

      (retriever as any).applyFolderBoost(documents);

      // Root level notes should not be boosted
      expect(documents[0].metadata.score).toBe(0.8);
      expect(documents[1].metadata.score).toBe(0.7);
      expect(documents[0].metadata.folderBoost).toBeUndefined();
      expect(documents[1].metadata.folderBoost).toBeUndefined();
    });

    it("should handle mixed folder depths correctly", () => {
      const documents: Document[] = [
        new Document({
          pageContent: "Deep note",
          metadata: { path: "folder1/subfolder/deep.md", score: 0.5 },
        }),
        new Document({
          pageContent: "Another deep note",
          metadata: { path: "folder1/subfolder/deep2.md", score: 0.6 },
        }),
        new Document({
          pageContent: "Shallow note",
          metadata: { path: "folder1/shallow.md", score: 0.7 },
        }),
      ];

      (retriever as any).applyFolderBoost(documents);

      // Deep notes in same subfolder should be boosted
      const deep1 = documents[0];
      const deep2 = documents[1];
      const shallow = documents[2];

      expect(deep1.metadata.score).toBeGreaterThan(0.5);
      expect(deep2.metadata.score).toBeGreaterThan(0.6);
      expect(shallow.metadata.score).toBe(0.7); // Only 1 in its folder
    });

    it("should cap boost factor at maximum", () => {
      // Create many notes in same folder to test max boost
      const documents: Document[] = Array.from(
        { length: 20 },
        (_, i) =>
          new Document({
            pageContent: `Note ${i}`,
            metadata: { path: `bigfolder/note${i}.md`, score: 1.0 },
          })
      );

      (retriever as any).applyFolderBoost(documents);

      // Check boost factor is capped at 1.3 (30% max boost)
      const boostFactor = documents[0].metadata.folderBoost;
      expect(boostFactor).toBeLessThanOrEqual(1.3);
      expect(boostFactor).toBeGreaterThan(1.2); // Should be close to max
    });
  });

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
      // Mock search results
      mockTieredRetriever.search.mockResolvedValue([
        { id: "note1.md", score: 0.8, engine: "fulltext" },
        { id: "note2.md", score: 0.6, engine: "grep" },
      ]);

      // Mock file system
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "note1.md" || path === "note2.md") {
          return { path, basename: path.replace(".md", ""), stat: { mtime: 1000, ctime: 1000 } };
        }
        return null;
      });

      mockApp.vault.cachedRead.mockResolvedValue("File content");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        tags: [{ tag: "#test" }],
      });
    });

    it("should integrate all components correctly", async () => {
      const query = "test query";
      const results = await retriever.getRelevantDocuments(query);

      // Should call tiered search
      expect(mockTieredRetriever.search).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.any(Object)
      );

      // Should return documents
      expect(results.length).toBe(2);
      expect(results[0].metadata.path).toBe("note1.md");
      expect(results[0].metadata.score).toBeGreaterThanOrEqual(0.8);
    });

    it("should handle empty search results", async () => {
      mockTieredRetriever.search.mockResolvedValue([]);

      const results = await retriever.getRelevantDocuments("no matches");
      expect(results).toEqual([]);
    });

    it("should extract mentioned notes from query", async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === "mentioned.md") {
          return { path, basename: "mentioned", stat: { mtime: 1000, ctime: 1000 } };
        }
        return mockApp.vault.getAbstractFileByPath(path);
      });

      const query = "search [[mentioned]] for something";
      const results = await retriever.getRelevantDocuments(query);

      // Should include the mentioned note
      const mentioned = results.find((d) => d.metadata.path === "mentioned.md");
      expect(mentioned).toBeDefined();
    });
  });
});
