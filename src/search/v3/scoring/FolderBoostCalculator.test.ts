import { App } from "obsidian";
import { NoteIdRank } from "../interfaces";
import { FolderBoostCalculator } from "./FolderBoostCalculator";

// Mock Obsidian app with vault
function createMockApp(files: string[]): App {
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((path) => ({
          path,
          basename: path.split("/").pop()?.replace(".md", "") || "",
          extension: "md",
        })),
    },
  } as any;
}

describe("FolderBoostCalculator", () => {
  let calculator: FolderBoostCalculator;
  let mockApp: App;

  beforeEach(() => {
    // Default mock app with no files
    mockApp = createMockApp([]);
    calculator = new FolderBoostCalculator(mockApp);
  });

  describe("applyBoosts", () => {
    it("should return results unchanged when disabled", () => {
      calculator.setConfig({ enabled: false });
      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosted = calculator.applyBoosts(results);
      expect(boosted).toEqual(results);
    });

    it("should return empty array for empty input", () => {
      const results: NoteIdRank[] = [];
      const boosted = calculator.applyBoosts(results);
      expect(boosted).toEqual([]);
    });

    it("should not boost folders with single document", () => {
      // Create vault with files
      mockApp = createMockApp(["folder1/note1.md", "folder2/note2.md", "folder3/note3.md"]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "folder1/note1.md", score: 0.8 },
        { id: "folder2/note2.md", score: 0.6 },
        { id: "folder3/note3.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);
      expect(boosted).toEqual(results); // No changes since each folder has only 1 doc
    });

    it("should boost documents when relevance ratio meets threshold", () => {
      // Create vault with 5 files in nextjs folder, 5 in tutorials
      mockApp = createMockApp([
        "nextjs/auth.md",
        "nextjs/config.md",
        "nextjs/api.md",
        "nextjs/routing.md",
        "nextjs/pages.md",
        "tutorials/oauth.md",
        "tutorials/jwt.md",
        "tutorials/sessions.md",
        "tutorials/cookies.md",
        "tutorials/cors.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "nextjs/auth.md", score: 0.3 },
        { id: "nextjs/config.md", score: 0.2 },
        { id: "nextjs/api.md", score: 0.15 },
        { id: "tutorials/oauth.md", score: 0.1 },
      ];

      const boosted = calculator.applyBoosts(results);

      // nextjs: 3/5 = 60% relevance ratio (meets 40% threshold)
      // tutorials: 1/5 = 20% (single doc, doesn't meet minDocsForBoost)
      expect(boosted[0].score).toBeGreaterThan(0.3);
      expect(boosted[1].score).toBeGreaterThan(0.2);
      expect(boosted[2].score).toBeGreaterThan(0.15);
      expect(boosted[3].score).toBe(0.1); // No boost (only 1 doc)
    });

    it("should not boost folders with low relevance ratio", () => {
      // Create vault with 10 files in folder, only 3 relevant (30%)
      mockApp = createMockApp([
        "folder/note1.md",
        "folder/note2.md",
        "folder/note3.md",
        "folder/note4.md",
        "folder/note5.md",
        "folder/note6.md",
        "folder/note7.md",
        "folder/note8.md",
        "folder/note9.md",
        "folder/note10.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
        { id: "folder/note3.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);

      // folder has 3/10 = 30% relevance ratio (below 40% threshold)
      expect(boosted[0].score).toBe(0.8); // No boost
      expect(boosted[1].score).toBe(0.6); // No boost
      expect(boosted[2].score).toBe(0.4); // No boost
    });

    it("should scale boost by relevance ratio", () => {
      // High relevance folder (80% of docs are relevant)
      mockApp = createMockApp([
        "project/file1.md",
        "project/file2.md",
        "project/file3.md",
        "project/file4.md",
        "project/file5.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "project/file1.md", score: 0.2 },
        { id: "project/file2.md", score: 0.2 },
        { id: "project/file3.md", score: 0.2 },
        { id: "project/file4.md", score: 0.2 },
      ];

      const boosted = calculator.applyBoosts(results);

      // 4/5 = 80% relevance ratio - should get strong boost
      // Base boost = 1 + log2(4 + 1) ≈ 2.32
      // Scaled by sqrt(0.8) ≈ 0.894
      // Final boost = 1 + (2.32 - 1) * 0.894 ≈ 2.18, capped at 1.15
      boosted.forEach((result) => {
        expect(result.score).toBeGreaterThan(0.2);
        expect(result.score).toBeLessThanOrEqual(0.2 * 1.15); // Capped at max boost
      });
    });

    it("should respect maxBoostFactor configuration", () => {
      mockApp = createMockApp([
        "folder/note1.md",
        "folder/note2.md",
        "folder/note3.md",
        "folder/note4.md",
        "folder/note5.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);
      calculator.setConfig({ maxBoostFactor: 1.2 });

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.5 },
        { id: "folder/note2.md", score: 0.5 },
        { id: "folder/note3.md", score: 0.5 },
        { id: "folder/note4.md", score: 0.5 },
        { id: "folder/note5.md", score: 0.5 },
      ];

      const boosted = calculator.applyBoosts(results);

      // 100% relevance ratio but boost capped at 1.2x
      boosted.forEach((result) => {
        expect(result.score).toBeLessThanOrEqual(0.5 * 1.2);
        expect(result.score).toBeGreaterThan(0.5); // Should have some boost
      });
    });

    it("should respect minDocsForBoost configuration", () => {
      mockApp = createMockApp(["folder/note1.md", "folder/note2.md"]);
      calculator = new FolderBoostCalculator(mockApp);
      calculator.setConfig({ minDocsForBoost: 3 });

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Only 2 docs, but minimum is 3, so no boost
      expect(boosted).toEqual(results);
    });

    it("should respect minRelevanceRatio configuration", () => {
      // Create vault with 5 files, 2 relevant (40% ratio)
      mockApp = createMockApp([
        "folder/note1.md",
        "folder/note2.md",
        "folder/note3.md",
        "folder/note4.md",
        "folder/note5.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);
      calculator.setConfig({ minRelevanceRatio: 0.5 }); // Require 50% relevance

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosted = calculator.applyBoosts(results);

      // 2/5 = 40% relevance ratio (below 50% threshold)
      expect(boosted).toEqual(results); // No boost
    });

    it("should handle root-level files correctly", () => {
      mockApp = createMockApp(["note1.md", "note2.md", "note3.md", "note4.md", "folder/note5.md"]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "note1.md", score: 0.8 },
        { id: "note2.md", score: 0.6 },
        { id: "folder/note5.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Root: 2/4 = 50% relevance ratio (meets 40% threshold)
      expect(boosted[0].score).toBeGreaterThan(0.8);
      expect(boosted[1].score).toBeGreaterThan(0.6);
      // Single file in folder, no boost
      expect(boosted[2].score).toBe(0.4);
    });

    it("should handle deeply nested folders", () => {
      mockApp = createMockApp([
        "a/b/c/d/note1.md",
        "a/b/c/d/note2.md",
        "a/b/c/d/note3.md",
        "a/b/note4.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "a/b/c/d/note1.md", score: 0.8 },
        { id: "a/b/c/d/note2.md", score: 0.6 },
        { id: "a/b/note4.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);

      // a/b/c/d: 2/3 = 67% relevance ratio (meets threshold)
      expect(boosted[0].score).toBeGreaterThan(0.8);
      expect(boosted[1].score).toBeGreaterThan(0.6);
      // a/b has 1 doc, no boost
      expect(boosted[2].score).toBe(0.4);
    });

    it("should work without app instance (fallback behavior)", () => {
      calculator = new FolderBoostCalculator(); // No app

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Without app, assumes all docs in search results are all docs in folder
      // 2/2 = 100% relevance ratio (meets threshold)
      expect(boosted[0].score).toBeGreaterThan(0.8);
      expect(boosted[1].score).toBeGreaterThan(0.6);
    });
  });

  describe("getFolderBoosts", () => {
    it("should return empty map when disabled", () => {
      calculator.setConfig({ enabled: false });
      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosts = calculator.getFolderBoosts(results);
      expect(boosts.size).toBe(0);
    });

    it("should return folder statistics without applying boosts", () => {
      mockApp = createMockApp([
        "nextjs/auth.md",
        "nextjs/config.md",
        "nextjs/jwt.md",
        "nextjs/other1.md",
        "nextjs/other2.md",
        "tutorials/oauth.md",
      ]);
      calculator = new FolderBoostCalculator(mockApp);

      const results: NoteIdRank[] = [
        { id: "nextjs/auth.md", score: 0.8 },
        { id: "nextjs/config.md", score: 0.6 },
        { id: "nextjs/jwt.md", score: 0.5 },
        { id: "tutorials/oauth.md", score: 0.4 },
      ];

      const boosts = calculator.getFolderBoosts(results);

      expect(boosts.size).toBe(1); // Only nextjs folder has multiple docs

      const nextjsBoost = boosts.get("nextjs");
      expect(nextjsBoost).toBeDefined();
      expect(nextjsBoost?.documentCount).toBe(3);
      expect(nextjsBoost?.totalDocsInFolder).toBe(5);
      expect(nextjsBoost?.relevanceRatio).toBeCloseTo(0.6, 2); // 3/5 = 60%
    });
  });
});
