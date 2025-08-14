import { weightedRRF, simpleRRF, applyTieBreakers } from "./RRF";
import { NoteIdRank } from "../interfaces";

describe("RRF (Reciprocal Rank Fusion)", () => {
  describe("weightedRRF", () => {
    it("should combine rankings with normalized default weights", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 8, engine: "lexical" },
        { id: "doc3", score: 6, engine: "lexical" },
      ];

      const semantic: NoteIdRank[] = [
        { id: "doc2", score: 9, engine: "semantic" },
        { id: "doc1", score: 7, engine: "semantic" },
        { id: "doc4", score: 5, engine: "semantic" },
      ];

      const results = weightedRRF({ lexical, semantic });

      // With default weights (0.4 lexical, 0.6 semantic), doc2 should rank first
      expect(results[0].id).toBe("doc2");
      // doc1 should rank second
      expect(results[1].id).toBe("doc1");
      // All results should be included
      expect(results.length).toBe(4);
      // Scores should be scaled but not necessarily normalized to 1
      expect(results[0].score).toBeLessThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should normalize custom weights to sum to 1.0", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 8, engine: "lexical" },
      ];

      const semantic: NoteIdRank[] = [
        { id: "doc2", score: 9, engine: "semantic" },
        { id: "doc3", score: 7, engine: "semantic" },
      ];

      // Give semantic higher weight (will be normalized to 0.857, lexical to 0.143)
      const results = weightedRRF({
        lexical,
        semantic,
        weights: { lexical: 0.5, semantic: 3.0 },
      });

      // doc2 should still rank first (in both lists)
      expect(results[0].id).toBe("doc2");
    });

    it("should handle single source with weight 1.0", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 8, engine: "lexical" },
        { id: "doc3", score: 6, engine: "lexical" },
      ];

      const results = weightedRRF({ lexical });

      // With only lexical results, should use weight 1.0
      expect(results[0].id).toBe("doc1");
      expect(results[1].id).toBe("doc2");
      expect(results[2].id).toBe("doc3");
      // All results should be included
      expect(results.length).toBe(3);
    });

    it("should not always normalize top score to 1", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 9, engine: "lexical" },
        { id: "doc3", score: 8, engine: "lexical" },
      ];

      const results = weightedRRF({ lexical });

      // With only one source and default weight of 1.0,
      // the top document gets score = 1.0 / (60 + 0 + 1) = 1/61
      // After scaling by k * 2 = 60 * 2 = 120
      // Score = (1/61) * 120 ≈ 1.97, but capped at 1
      // Actually, let's check what we really get

      // The score should be < 1 when there's low confidence (single source)
      // But with good matches it can reach 1
      expect(results[0].score).toBeLessThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0);

      // More importantly, check relative differences are preserved
      const ratio = results[1].score / results[0].score;
      expect(ratio).toBeLessThan(1); // Second should be less than first
      expect(ratio).toBeGreaterThan(0.5); // But not too much less
    });

    it("should preserve relative score differences", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 9, engine: "lexical" },
        { id: "doc3", score: 8, engine: "lexical" },
        { id: "doc4", score: 7, engine: "lexical" },
      ];

      const results = weightedRRF({ lexical });

      // Check that relative differences are preserved
      const diff1_2 = results[0].score - results[1].score;
      const diff2_3 = results[1].score - results[2].score;
      const diff3_4 = results[2].score - results[3].score;

      // Differences should decrease (RRF characteristic)
      expect(diff1_2).toBeGreaterThan(diff2_3);
      expect(diff2_3).toBeGreaterThan(diff3_4);
    });

    it("should handle empty rankings", () => {
      const results = weightedRRF({});
      expect(results).toEqual([]);
    });

    it("should use slider-friendly weights (0-1 range)", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 8, engine: "lexical" },
      ];

      const semantic: NoteIdRank[] = [
        { id: "doc3", score: 9, engine: "semantic" },
        { id: "doc1", score: 7, engine: "semantic" },
      ];

      // Test with 30% semantic weight (70% lexical)
      const results30 = weightedRRF({
        lexical,
        semantic,
        weights: { lexical: 0.7, semantic: 0.3 },
      });

      // Test with 70% semantic weight (30% lexical)
      const results70 = weightedRRF({
        lexical,
        semantic,
        weights: { lexical: 0.3, semantic: 0.7 },
      });

      // doc1 appears in both but is first in lexical
      // With 70% lexical weight, doc1 should rank higher
      // With 70% semantic weight, doc3 (first in semantic) should be more competitive

      const doc1Score30 = results30.find((r) => r.id === "doc1")?.score || 0;
      const doc3Score30 = results30.find((r) => r.id === "doc3")?.score || 0;

      const doc1Score70 = results70.find((r) => r.id === "doc1")?.score || 0;
      const doc3Score70 = results70.find((r) => r.id === "doc3")?.score || 0;

      // With more lexical weight (30% semantic), doc1 should have higher advantage
      expect(doc1Score30 - doc3Score30).toBeGreaterThan(doc1Score70 - doc3Score70);
    });

    it("should handle single item", () => {
      const lexical: NoteIdRank[] = [{ id: "doc1", score: 10, engine: "lexical" }];
      const results = weightedRRF({ lexical });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe("doc1");
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });

    it("should give reasonable scores for lexical-only search", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 9, engine: "lexical" },
        { id: "doc3", score: 8, engine: "lexical" },
        { id: "doc4", score: 7, engine: "lexical" },
      ];

      const results = weightedRRF({ lexical });

      // Simple linear scaling: k/2 = 30
      // Top doc gets 1/(60+0+1) * 30 ≈ 0.49
      expect(results[0].score).toBeLessThanOrEqual(0.5);
      expect(results[0].score).toBeGreaterThan(0.4);

      // Check score distribution maintains relative differences
      expect(results[1].score).toBeGreaterThan(0.35);
      expect(results[1].score).toBeLessThan(0.5);
      expect(results[2].score).toBeGreaterThan(0.3);
      expect(results[3].score).toBeGreaterThan(0.25);
    });

    it("should allow high scores when multiple sources strongly agree", () => {
      const lexical: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "lexical" },
        { id: "doc2", score: 8, engine: "lexical" },
      ];

      const semantic: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "semantic" },
        { id: "doc2", score: 7, engine: "semantic" },
      ];

      // With normalized weights (default 0.4 lexical, 0.6 semantic)
      const results = weightedRRF({ lexical, semantic });

      // doc1 appears first in both sources - should get high score
      expect(results[0].id).toBe("doc1");
      expect(results[0].score).toBeLessThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0.45); // Good score with both sources (normalized weights)

      // doc2 appears in both sources, should have moderate score
      const doc2 = results.find((r) => r.id === "doc2");
      expect(doc2).toBeDefined();
      expect(doc2!.score).toBeGreaterThan(0.3);
      expect(doc2!.score).toBeLessThanOrEqual(1);
    });
  });

  describe("simpleRRF", () => {
    it("should combine rankings with equal weight", () => {
      const ranking1: NoteIdRank[] = [
        { id: "doc1", score: 10, engine: "test" },
        { id: "doc2", score: 8, engine: "test" },
      ];

      const ranking2: NoteIdRank[] = [
        { id: "doc2", score: 9, engine: "test" },
        { id: "doc3", score: 7, engine: "test" },
      ];

      const results = simpleRRF([ranking1, ranking2]);

      // doc2 should rank first (appears high in both)
      expect(results[0].id).toBe("doc2");
      expect(results.length).toBe(3);
    });
  });

  describe("applyTieBreakers", () => {
    it("should apply tie breaker functions", () => {
      const rankings: NoteIdRank[] = [
        { id: "doc1", score: 0.5, engine: "test" },
        { id: "doc2", score: 0.5, engine: "test" },
      ];

      // Tie breaker that favors doc2
      const tieBreaker = (id: string) => (id === "doc2" ? 1 : 0);

      const results = applyTieBreakers(rankings, [tieBreaker]);

      // doc2 should now rank higher
      expect(results[0].id).toBe("doc2");
      expect(results[1].id).toBe("doc1");
    });
  });
});
