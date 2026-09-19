import {
  alignBlocks,
  alignSequences,
  diceSimilarity,
  pairRuns,
  PAIR_SIMILARITY_THRESHOLD,
} from "@/agentMode/ui/renderedDiff/alignBlocks";
import type { MarkdownBlock } from "@/agentMode/ui/renderedDiff/splitBlocks";

const paragraph = (text: string): MarkdownBlock => ({ type: "text", text });
const heading = (text: string): MarkdownBlock => ({ type: "heading", text });

describe("alignBlocks", () => {
  describe("diceSimilarity()", () => {
    it("scores identical text 1", () => {
      expect(diceSimilarity("The pilot runs.", "The pilot runs.")).toBe(1);
    });

    it("scores a lightly reworded sentence above the pairing threshold", () => {
      const score = diceSimilarity(
        "The pilot runs for six weeks with two design partners.",
        "The pilot runs for eight weeks with three design partners."
      );

      expect(score).toBeGreaterThan(PAIR_SIMILARITY_THRESHOLD);
      expect(score).toBeLessThan(1);
    });

    it("scores unrelated sentences below the pairing threshold", () => {
      expect(diceSimilarity("Budget is fixed.", "Ship the migration runbook")).toBeLessThan(
        PAIR_SIMILARITY_THRESHOLD
      );
    });

    it("scores text shorter than one bigram 0 because it carries no bigrams to compare", () => {
      expect(diceSimilarity("a", "b")).toBe(0);
    });
  });

  describe("pairRuns()", () => {
    it("pairs a removed element with the similar added element that follows it", () => {
      const pairings = pairRuns(["six weeks"], ["eight weeks"], diceSimilarity);

      expect(pairings).toEqual([{ kind: "modified", before: "six weeks", after: "eight weeks" }]);
    });

    it("leaves an element deleted when no added element is similar enough", () => {
      const pairings = pairRuns(["six weeks"], ["Budget is fixed"], diceSimilarity);

      expect(pairings).toEqual([
        { kind: "deleted", before: "six weeks" },
        { kind: "inserted", after: "Budget is fixed" },
      ]);
    });

    it("emits the added elements that precede a pair before the pair itself", () => {
      const pairings = pairRuns(["six weeks"], ["Budget is fixed", "eight weeks"], diceSimilarity);

      expect(pairings).toEqual([
        { kind: "inserted", after: "Budget is fixed" },
        { kind: "modified", before: "six weeks", after: "eight weeks" },
      ]);
    });
  });

  describe("alignSequences()", () => {
    it("reports elements present on both sides as unchanged", () => {
      const pairings = alignSequences(["a", "b"], ["a", "b"], {
        isEqual: (left, right) => left === right,
        similarity: diceSimilarity,
      });

      expect(pairings).toEqual([
        { kind: "unchanged", before: "a", after: "a" },
        { kind: "unchanged", before: "b", after: "b" },
      ]);
    });
  });

  describe("alignBlocks()", () => {
    it("reports an edited paragraph as one modified block rather than a delete and an insert", () => {
      const before = [paragraph("The pilot runs for six weeks with two design partners.")];
      const after = [paragraph("The pilot runs for eight weeks with three design partners.")];

      expect(alignBlocks(before, after)).toEqual([
        { kind: "modified", before: before[0], after: after[0] },
      ]);
    });

    it("never pairs blocks of different kinds even when their text is nearly identical", () => {
      const before = [heading("## Rollout plan")];
      const after = [paragraph("## Rollout plan!")];

      expect(alignBlocks(before, after)).toEqual([
        { kind: "deleted", before: before[0] },
        { kind: "inserted", after: after[0] },
      ]);
    });

    it("reports a block moved elsewhere as a deletion and a separate insertion", () => {
      const budget = paragraph("Budget is fixed for the quarter.");
      const pilot = paragraph("The pilot runs for six weeks.");

      expect(alignBlocks([budget, pilot], [pilot, budget])).toEqual([
        { kind: "deleted", before: budget },
        { kind: "unchanged", before: pilot, after: pilot },
        { kind: "inserted", after: budget },
      ]);
    });
  });
});
