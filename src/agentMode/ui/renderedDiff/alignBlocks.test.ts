import {
  alignBlocks,
  alignSequences,
  diceSimilarity,
} from "@/agentMode/ui/renderedDiff/alignBlocks";
import type { MarkdownBlock } from "@/agentMode/ui/renderedDiff/splitBlocks";

const paragraph = (text: string): MarkdownBlock => ({ type: "text", text });
const heading = (text: string): MarkdownBlock => ({ type: "heading", text });

describe("alignBlocks", () => {
  describe("diceSimilarity()", () => {
    it("scores identical text 1", () => {
      expect(diceSimilarity("The pilot runs.", "The pilot runs.")).toBe(1);
    });

    it("scores a lightly reworded sentence by the share of character bigrams the two versions keep", () => {
      const score = diceSimilarity(
        "The pilot runs for six weeks with two design partners.",
        "The pilot runs for eight weeks with three design partners."
      );

      expect(score).toBeCloseTo(0.836, 3);
    });

    it("scores sentences sharing no bigram 0", () => {
      expect(diceSimilarity("Budget is fixed.", "Ship the migration runbook")).toBe(0);
    });

    it("scores text shorter than one bigram 0 because it carries no bigrams to compare", () => {
      expect(diceSimilarity("a", "b")).toBe(0);
    });
  });

  describe("alignSequences()", () => {
    const rules = {
      isEqual: (left: string, right: string) => left === right,
      similarity: diceSimilarity,
    };

    it("reports elements present on both sides as unchanged", () => {
      expect(alignSequences(["a", "b"], ["a", "b"], rules)).toEqual([
        { kind: "unchanged", before: "a", after: "a" },
        { kind: "unchanged", before: "b", after: "b" },
      ]);
    });

    it("pairs a removed element with the similar added element that replaces it", () => {
      expect(alignSequences(["six weeks"], ["eight weeks"], rules)).toEqual([
        { kind: "modified", before: "six weeks", after: "eight weeks" },
      ]);
    });

    it("leaves an element deleted when no added element is similar enough", () => {
      expect(alignSequences(["six weeks"], ["Budget is fixed"], rules)).toEqual([
        { kind: "deleted", before: "six weeks" },
        { kind: "inserted", after: "Budget is fixed" },
      ]);
    });

    it("emits the added elements that precede a pair before the pair itself", () => {
      expect(alignSequences(["six weeks"], ["Budget is fixed", "eight weeks"], rules)).toEqual([
        { kind: "inserted", after: "Budget is fixed" },
        { kind: "modified", before: "six weeks", after: "eight weeks" },
      ]);
    });

    it("pairs every line of a 1,000-line run where each line changed while scoring each line against a bounded window of candidates (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", () => {
      const before = Array.from({ length: 1000 }, (_, index) => `- item ${index} keeps its text`);
      const after = Array.from({ length: 1000 }, (_, index) => `- item ${index} keeps new text`);
      const similarity = jest.fn(diceSimilarity);

      const pairings = alignSequences(before, after, {
        isEqual: (left, right) => left === right,
        similarity,
      });

      expect(pairings).toEqual(
        before.map((line, index) => ({ kind: "modified", before: line, after: after[index] }))
      );
      expect(similarity.mock.calls.length).toBeLessThanOrEqual(1000 * 32);
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
