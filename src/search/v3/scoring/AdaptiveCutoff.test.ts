import { NoteIdRank } from "../interfaces";
import { adaptiveCutoff } from "./AdaptiveCutoff";

/** Helper: create chunks from a note */
function chunks(note: string, scores: number[]): NoteIdRank[] {
  return scores.map((score, i) => ({ id: `${note}#${i}`, score }));
}

describe("AdaptiveCutoff", () => {
  describe("score-based cutoff", () => {
    it("should keep all results when all scores are above threshold", () => {
      const results: NoteIdRank[] = [
        { id: "a.md#0", score: 0.9 },
        { id: "b.md#0", score: 0.8 },
        { id: "c.md#0", score: 0.7 },
        { id: "d.md#0", score: 0.5 },
      ];

      const { results: selected } = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.9 * 0.3 = 0.27
        ceiling: 30,
      });

      // All scores > 0.27, so all should be included
      expect(selected).toHaveLength(4);
    });

    it("should cut off results below relative threshold", () => {
      const results: NoteIdRank[] = [
        { id: "a.md#0", score: 0.9 },
        { id: "b.md#0", score: 0.8 },
        { id: "c.md#0", score: 0.1 }, // Below 0.9 * 0.3 = 0.27
        { id: "d.md#0", score: 0.05 },
      ];

      const { results: selected, cutoffScore } = adaptiveCutoff(results, {
        relativeThreshold: 0.3,
        floor: 1,
        ceiling: 30,
      });

      expect(selected).toHaveLength(2);
      expect(cutoffScore).toBeCloseTo(0.27);
    });

    it("should respect floor even when scores drop", () => {
      const results: NoteIdRank[] = [
        { id: "a.md#0", score: 0.9 },
        { id: "b.md#0", score: 0.1 }, // Below threshold but within floor
        { id: "c.md#0", score: 0.05 },
      ];

      const { results: selected } = adaptiveCutoff(results, {
        relativeThreshold: 0.3,
        floor: 3,
        ceiling: 30,
      });

      // Floor is 3, so all 3 must be included regardless of score
      expect(selected).toHaveLength(3);
    });

    it("should respect ceiling", () => {
      const results: NoteIdRank[] = Array.from({ length: 20 }, (_, i) => ({
        id: `note${i}.md#0`,
        score: 0.9 - i * 0.01, // All high scores
      }));

      const { results: selected } = adaptiveCutoff(results, { ceiling: 5 });

      expect(selected).toHaveLength(5);
    });

    it("should return cutoffScore=null when all results are included", () => {
      const results: NoteIdRank[] = [
        { id: "a.md#0", score: 0.9 },
        { id: "b.md#0", score: 0.8 },
      ];

      const { cutoffScore } = adaptiveCutoff(results, { ceiling: 30 });
      expect(cutoffScore).toBeNull();
    });

    it("should handle empty input", () => {
      const { results: selected, uniqueNotes, totalBefore } = adaptiveCutoff([]);
      expect(selected).toHaveLength(0);
      expect(uniqueNotes).toBe(0);
      expect(totalBefore).toBe(0);
    });
  });

  describe("diversity guarantee", () => {
    it("should include all unique notes before any note gets a second chunk", () => {
      // Note A dominates scoring, but B and C should still appear
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.95, 0.9, 0.85, 0.8]),
        ...chunks("noteB.md", [0.5]),
        ...chunks("noteC.md", [0.45]),
      ];

      const { results: selected, uniqueNotes } = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.95 * 0.3 = 0.285
        ceiling: 30,
        ensureDiversity: true,
      });

      expect(uniqueNotes).toBe(3);
      // All notes represented since all scores > 0.285
      const noteIds = new Set(selected.map((r) => r.id.split("#")[0]));
      expect(noteIds.has("noteA.md")).toBe(true);
      expect(noteIds.has("noteB.md")).toBe(true);
      expect(noteIds.has("noteC.md")).toBe(true);
    });

    it("should cut low-scoring notes even with diversity when below threshold and above floor", () => {
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.9, 0.85]),
        ...chunks("noteB.md", [0.8]),
        ...chunks("noteC.md", [0.05]), // Well below threshold 0.27
      ];

      const { results: selected, uniqueNotes } = adaptiveCutoff(results, {
        relativeThreshold: 0.3,
        floor: 2,
        ceiling: 30,
        ensureDiversity: true,
      });

      // noteC is below threshold and we're past the floor
      expect(uniqueNotes).toBe(2);
      const noteIds = new Set(selected.map((r) => r.id.split("#")[0]));
      expect(noteIds.has("noteC.md")).toBe(false);
    });

    it("should fill remaining slots with additional chunks after diversity phase", () => {
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.95, 0.9, 0.85]),
        ...chunks("noteB.md", [0.7, 0.65]),
      ];

      const { results: selected } = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.285
        ceiling: 30,
        ensureDiversity: true,
      });

      // All 5 results above threshold, all should be included
      expect(selected).toHaveLength(5);
    });

    it("should work without diversity", () => {
      // Without diversity, noteA dominates and noteB gets cut by threshold
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.9, 0.85, 0.8]),
        ...chunks("noteB.md", [0.1]), // Below threshold
      ];

      const { results: selected } = adaptiveCutoff(results, {
        relativeThreshold: 0.3,
        floor: 1,
        ensureDiversity: false,
      });

      expect(selected).toHaveLength(3);
      expect(selected.every((r) => r.id.startsWith("noteA.md"))).toBe(true);
    });

    it("should treat floor as chunk count, not unique note count", () => {
      // 2 notes, first has 3 high-scoring chunks, second has low score
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.9, 0.85, 0.8]),
        ...chunks("noteB.md", [0.1]), // Below threshold 0.27
      ];

      const { results: selected, uniqueNotes } = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.9 * 0.3 = 0.27
        floor: 3,
        ceiling: 30,
        ensureDiversity: true,
      });

      // Floor=3 means at least 3 chunks returned regardless of score
      // Phase 1: noteA#0 (0.9, new note), noteB#0 (0.1, new note, forced by floor)
      // Phase 2: noteA#1 (0.85, above threshold, fills to 3+)
      expect(selected.length).toBeGreaterThanOrEqual(3);
      expect(uniqueNotes).toBe(2);
    });
  });

  describe("output ordering", () => {
    it("should return results sorted by score descending", () => {
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.95, 0.8]),
        ...chunks("noteB.md", [0.9]),
        ...chunks("noteC.md", [0.85]),
      ];

      const { results: selected } = adaptiveCutoff(results, { ceiling: 30 });

      for (let i = 1; i < selected.length; i++) {
        expect(selected[i].score).toBeLessThanOrEqual(selected[i - 1].score);
      }
    });
  });

  describe("metadata", () => {
    it("should report correct unique note count", () => {
      const results: NoteIdRank[] = [
        ...chunks("noteA.md", [0.9, 0.8]),
        ...chunks("noteB.md", [0.7]),
      ];

      const { uniqueNotes, totalBefore } = adaptiveCutoff(results);

      expect(uniqueNotes).toBe(2);
      expect(totalBefore).toBe(3);
    });
  });

  describe("real-world scenarios", () => {
    it("find-all query: 8 AI digest notes should all be kept", () => {
      // Simulates "find my ai digests" — 8 notes, each with 2-3 chunks
      const results: NoteIdRank[] = [];
      for (let i = 0; i < 8; i++) {
        results.push(...chunks(`2026-0${i + 1}-AI-Digest.md`, [0.8 - i * 0.03, 0.7 - i * 0.03]));
      }

      const result = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.8 * 0.3 = 0.24
        ceiling: 30,
      });

      // All 8 notes score above 0.24, so all should appear
      expect(result.uniqueNotes).toBe(8);
      expect(result.results.length).toBe(16); // 8 notes × 2 chunks each
    });

    it("precision query: 2 relevant notes among noise should trim to just those", () => {
      // Simulates "what is quantum computing" — 2 strong matches, rest is noise
      const results: NoteIdRank[] = [
        ...chunks("quantum-computing.md", [0.95, 0.88]),
        ...chunks("physics-overview.md", [0.82]),
        ...chunks("random-note1.md", [0.15]),
        ...chunks("random-note2.md", [0.1]),
        ...chunks("random-note3.md", [0.08]),
        ...chunks("random-note4.md", [0.05]),
      ];

      const { results: selected, uniqueNotes } = adaptiveCutoff(results, {
        relativeThreshold: 0.3, // threshold = 0.95 * 0.3 = 0.285
        floor: 3,
        ceiling: 30,
      });

      // Phase 1: quantum(0.95), physics(0.82), random1(0.15 — floor=3 forces it)
      // Phase 2: quantum#1(0.88) fills from remaining (above threshold 0.285)
      // Then random2(0.10) < threshold → stop
      expect(uniqueNotes).toBe(3);
      expect(selected).toHaveLength(4);
      const noteIds = new Set(selected.map((r) => r.id.split("#")[0]));
      expect(noteIds.has("quantum-computing.md")).toBe(true);
      expect(noteIds.has("physics-overview.md")).toBe(true);
      expect(noteIds.has("random-note2.md")).toBe(false);
    });
  });
});
