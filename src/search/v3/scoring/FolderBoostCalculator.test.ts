import { NoteIdRank } from "../interfaces";
import { FolderBoostCalculator } from "./FolderBoostCalculator";

describe("FolderBoostCalculator", () => {
  let calculator: FolderBoostCalculator;

  beforeEach(() => {
    calculator = new FolderBoostCalculator();
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
      const results: NoteIdRank[] = [
        { id: "folder1/note1.md", score: 0.8 },
        { id: "folder2/note2.md", score: 0.6 },
        { id: "folder3/note3.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);
      expect(boosted).toEqual(results); // No changes since each folder has only 1 doc
    });

    it("should boost documents in folders with multiple matches", () => {
      const results: NoteIdRank[] = [
        { id: "nextjs/auth.md", score: 0.3 },
        { id: "nextjs/config.md", score: 0.2 },
        { id: "tutorials/oauth.md", score: 0.1 },
      ];

      const boosted = calculator.applyBoosts(results);

      // nextjs folder has 2 docs, boost = 1 + log2(2 + 1) = 1 + log2(3) ≈ 2.585
      const expectedBoost = 1 + Math.log2(3);
      expect(boosted[0].score).toBeCloseTo(0.3 * expectedBoost, 2);
      expect(boosted[1].score).toBeCloseTo(0.2 * expectedBoost, 2);
      // tutorials folder has 1 doc, no boost
      expect(boosted[2].score).toBe(0.1);
    });

    it("should apply logarithmic boost based on document count", () => {
      const results: NoteIdRank[] = [
        { id: "popular/note1.md", score: 0.2 },
        { id: "popular/note2.md", score: 0.2 },
        { id: "popular/note3.md", score: 0.2 },
        { id: "popular/note4.md", score: 0.2 },
        { id: "popular/note5.md", score: 0.2 },
      ];

      const boosted = calculator.applyBoosts(results);

      // 5 docs in folder: boost = 1 + log2(5 + 1) ≈ 3.585, but capped at 3.0
      const expectedBoost = Math.min(1 + Math.log2(6), 3.0); // Capped at default maxBoostFactor
      boosted.forEach((result) => {
        expect(result.score).toBeCloseTo(0.2 * expectedBoost, 2);
      });
    });

    it("should allow scores above 1.0 (normalizer will handle it)", () => {
      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.9 },
        { id: "folder/note2.md", score: 0.9 },
      ];

      const boosted = calculator.applyBoosts(results);

      // With boost = 1 + log2(3) ≈ 2.585, scores can exceed 1.0
      // This is OK - the ScoreNormalizer will handle normalization
      const expectedBoost = 1 + Math.log2(3);
      boosted.forEach((result) => {
        expect(result.score).toBeCloseTo(0.9 * expectedBoost, 2);
        expect(result.score).toBeGreaterThan(1.0);
      });
    });

    it("should respect maxBoostFactor configuration", () => {
      calculator.setConfig({ maxBoostFactor: 1.5 });

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.5 },
        { id: "folder/note2.md", score: 0.5 },
        { id: "folder/note3.md", score: 0.5 },
        { id: "folder/note4.md", score: 0.5 },
        { id: "folder/note5.md", score: 0.5 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Boost should be capped at 1.5x
      boosted.forEach((result) => {
        expect(result.score).toBeLessThanOrEqual(0.5 * 1.5);
      });
    });

    it("should respect minDocsForBoost configuration", () => {
      calculator.setConfig({ minDocsForBoost: 3 });

      const results: NoteIdRank[] = [
        { id: "folder/note1.md", score: 0.8 },
        { id: "folder/note2.md", score: 0.6 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Only 2 docs, but minimum is 3, so no boost
      expect(boosted).toEqual(results);
    });

    it("should handle root-level files correctly", () => {
      const results: NoteIdRank[] = [
        { id: "note1.md", score: 0.8 },
        { id: "note2.md", score: 0.6 },
        { id: "folder/note3.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);

      // Root files (empty folder path) should be boosted if multiple exist
      expect(boosted[0].score).toBeGreaterThan(0.8);
      expect(boosted[1].score).toBeGreaterThan(0.6);
      // Single file in folder, no boost
      expect(boosted[2].score).toBe(0.4);
    });

    it("should handle deeply nested folders", () => {
      const results: NoteIdRank[] = [
        { id: "a/b/c/d/note1.md", score: 0.8 },
        { id: "a/b/c/d/note2.md", score: 0.6 },
        { id: "a/b/note3.md", score: 0.4 },
      ];

      const boosted = calculator.applyBoosts(results);

      // a/b/c/d has 2 docs, should be boosted
      expect(boosted[0].score).toBeGreaterThan(0.8);
      expect(boosted[1].score).toBeGreaterThan(0.6);
      // a/b has 1 doc, no boost
      expect(boosted[2].score).toBe(0.4);
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
      expect(nextjsBoost?.boostFactor).toBeCloseTo(3.0, 1); // 1 + log2(3 + 1) = 3
    });
  });
});
