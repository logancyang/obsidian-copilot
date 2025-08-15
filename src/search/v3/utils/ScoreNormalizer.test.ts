import { NoteIdRank } from "../interfaces";
import { ScoreNormalizer } from "./ScoreNormalizer";

describe("ScoreNormalizer", () => {
  describe("zscore-tanh normalization", () => {
    it("should normalize scores to avoid auto-1.0", () => {
      const normalizer = new ScoreNormalizer({ method: "zscore-tanh" });

      const results: NoteIdRank[] = [
        { id: "note1", score: 10.0 },
        { id: "note2", score: 5.0 },
        { id: "note3", score: 2.0 },
        { id: "note4", score: 1.0 },
        { id: "note5", score: 0.5 },
      ];

      const normalized = normalizer.normalize(results);

      // Top score should be high but not 1.0
      expect(normalized[0].score).toBeLessThan(0.98);
      expect(normalized[0].score).toBeGreaterThan(0.7);

      // Bottom score should be low but not 0.0
      expect(normalized[4].score).toBeGreaterThan(0.02);
      expect(normalized[4].score).toBeLessThan(0.4);

      // Scores should maintain order
      for (let i = 1; i < normalized.length; i++) {
        expect(normalized[i].score).toBeLessThan(normalized[i - 1].score);
      }
    });

    it("should handle identical scores", () => {
      const normalizer = new ScoreNormalizer({ method: "zscore-tanh" });

      const results: NoteIdRank[] = [
        { id: "note1", score: 0.5 },
        { id: "note2", score: 0.5 },
        { id: "note3", score: 0.5 },
      ];

      const normalized = normalizer.normalize(results);

      // All identical scores should map to 0.5
      normalized.forEach((r) => {
        expect(r.score).toBe(0.5);
      });
    });

    it("should preserve explanations", () => {
      const normalizer = new ScoreNormalizer({ method: "zscore-tanh" });

      const results: NoteIdRank[] = [
        {
          id: "note1",
          score: 1.0,
          explanation: {
            baseScore: 0.8,
            finalScore: 1.0,
            lexicalMatches: [{ field: "title", query: "test", weight: 3 }],
          },
        },
      ];

      const normalized = normalizer.normalize(results);

      expect(normalized[0].explanation).toBeDefined();
      // Since there's only one result, it should normalize to 0.5 (middle value)
      expect(normalized[0].score).toBe(0.5);
      expect(normalized[0].explanation?.finalScore).toBe(normalized[0].score);
      expect(normalized[0].explanation?.lexicalMatches).toEqual([
        { field: "title", query: "test", weight: 3 },
      ]);
    });

    it("should respect custom scale and clip values", () => {
      const normalizer = new ScoreNormalizer({
        method: "zscore-tanh",
        tanhScale: 1.5,
        clipMin: 0.1,
        clipMax: 0.9,
      });

      const results: NoteIdRank[] = [
        { id: "note1", score: 10.0 },
        { id: "note2", score: 0.1 },
      ];

      const normalized = normalizer.normalize(results);

      expect(normalized[0].score).toBeLessThanOrEqual(0.9);
      expect(normalized[1].score).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe("minmax normalization", () => {
    it("should scale scores linearly to [clipMin, clipMax]", () => {
      const normalizer = new ScoreNormalizer({ method: "minmax" });

      const results: NoteIdRank[] = [
        { id: "note1", score: 10.0 },
        { id: "note2", score: 5.0 },
        { id: "note3", score: 0.0 },
      ];

      const normalized = normalizer.normalize(results);

      // Top score should map to clipMax
      expect(normalized[0].score).toBeCloseTo(0.98, 2);

      // Bottom score should map to clipMin
      expect(normalized[2].score).toBeCloseTo(0.02, 2);

      // Middle score should be in between
      expect(normalized[1].score).toBeCloseTo(0.5, 1);
    });

    it("should preserve monotonicity of scores (bug from screenshot)", () => {
      const normalizer = new ScoreNormalizer({
        method: "minmax",
        clipMin: 0.02,
        clipMax: 0.98,
      });

      // Test case from the bug report - scores that are not preserving order
      const results: NoteIdRank[] = [
        { id: "Superlinear Returns", score: 33.7378, engine: "lexical" },
        { id: "Model Comparison Demo", score: 1.3114, engine: "lexical" },
        { id: "doc3", score: 0.5, engine: "lexical" },
      ];

      const normalized = normalizer.normalize(results);

      // Check monotonicity: if a.score > b.score before normalization,
      // then a.score > b.score after normalization
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const originalOrder = results[i].score > results[j].score;
          const normalizedOrder = normalized[i].score > normalized[j].score;
          expect(originalOrder).toBe(normalizedOrder);
        }
      }

      // Specifically check the problematic case
      // Superlinear (33.7378) > Model Comparison (1.3114) > doc3 (0.5)
      expect(normalized[0].score).toBeGreaterThan(normalized[1].score);
      expect(normalized[1].score).toBeGreaterThan(normalized[2].score);
    });
  });

  describe("percentile normalization", () => {
    it("should map scores to percentile ranks", () => {
      const normalizer = new ScoreNormalizer({ method: "percentile" });

      const results: NoteIdRank[] = [
        { id: "note1", score: 100 },
        { id: "note2", score: 50 },
        { id: "note3", score: 25 },
        { id: "note4", score: 10 },
        { id: "note5", score: 1 },
      ];

      const normalized = normalizer.normalize(results);

      // Scores should be evenly distributed
      const expectedPercentiles = [0.98, 0.755, 0.5, 0.245, 0.02];
      normalized.forEach((r, i) => {
        expect(r.score).toBeCloseTo(expectedPercentiles[i], 1);
      });
    });
  });

  describe("getStatistics", () => {
    it("should calculate correct statistics", () => {
      const normalizer = new ScoreNormalizer();

      const results: NoteIdRank[] = [
        { id: "note1", score: 1.0 },
        { id: "note2", score: 2.0 },
        { id: "note3", score: 3.0 },
        { id: "note4", score: 4.0 },
        { id: "note5", score: 5.0 },
      ];

      const stats = normalizer.getStatistics(results);

      expect(stats.mean).toBe(3.0);
      expect(stats.min).toBe(1.0);
      expect(stats.max).toBe(5.0);
      expect(stats.median).toBe(3.0);
      expect(stats.std).toBeCloseTo(1.414, 2);
    });

    it("should handle empty results", () => {
      const normalizer = new ScoreNormalizer();
      const stats = normalizer.getStatistics([]);

      expect(stats.mean).toBe(0);
      expect(stats.std).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.median).toBe(0);
    });
  });
});
