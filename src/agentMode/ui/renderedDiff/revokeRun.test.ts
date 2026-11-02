import type { DiffRun } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { locateRun, revokeRun } from "@/agentMode/ui/renderedDiff/revokeRun";

const BEFORE =
  "# Pilot\n\nThe pilot runs for six weeks.\n\nBudget is open.\n\nWe report every Friday.\n";
const AFTER =
  "# Pilot\n\nThe pilot runs for eight weeks.\n\nBudget is open.\n\nWe report every Monday.\n";
const FIRST_RUN: DiffRun = { before: { start: 1, end: 4 }, after: { start: 1, end: 4 } };
const SECOND_RUN: DiffRun = { before: { start: 5, end: 8 }, after: { start: 5, end: 8 } };

describe("revokeRun", () => {
  describe("locateRun()", () => {
    it("finds the run on the lines the turn left it on while the note is unchanged", () => {
      expect(locateRun(AFTER, AFTER, FIRST_RUN)).toEqual({ start: 1, end: 4 });
    });

    it("follows the run to its new lines when text was added above it after the turn", () => {
      const current = `Added later.\n\n${AFTER}`;

      expect(locateRun(AFTER, current, SECOND_RUN)).toEqual({ start: 7, end: 10 });
    });

    it("follows the run when a paragraph was added right above it after the turn, though the diff pairs the run's leading blank line with the added one (https://github.com/Brevilabs/obsidian-copilot-private/issues/823)", () => {
      const current = AFTER.replace("Budget is open.\n\n", "Budget is open.\n\nAdded later.\n\n");

      expect(locateRun(AFTER, current, SECOND_RUN)).toEqual({ start: 7, end: 10 });
    });

    it("finds no location once text inside the run changed after the turn", () => {
      const current = AFTER.replace("every Monday", "every Tuesday");

      expect(locateRun(AFTER, current, SECOND_RUN)).toBeNull();
    });

    it("finds no location for a run that only removed text once a line beside the removal changed (https://github.com/Brevilabs/obsidian-copilot-private/issues/823)", () => {
      const after = "Intro stays.\n\nOutro stays.\n";
      const removal: DiffRun = { before: { start: 1, end: 4 }, after: { start: 1, end: 2 } };

      expect(locateRun(after, after, removal)).toEqual({ start: 1, end: 2 });
      expect(locateRun(after, "Intro reworded.\n\nOutro stays.\n", removal)).toBeNull();
    });
  });

  describe("revokeRun()", () => {
    it("puts the run back to its text from before the turn in both the note and the turn's result", () => {
      expect(revokeRun(BEFORE, AFTER, AFTER, FIRST_RUN)).toEqual({
        after:
          "# Pilot\n\nThe pilot runs for six weeks.\n\nBudget is open.\n\nWe report every Monday.\n",
        current:
          "# Pilot\n\nThe pilot runs for six weeks.\n\nBudget is open.\n\nWe report every Monday.\n",
      });
    });

    it("keeps edits made after the turn outside the run, which the turn's result never had", () => {
      const current = AFTER.replace("Budget is open.", "Budget is fixed.");

      expect(revokeRun(BEFORE, AFTER, current, SECOND_RUN)).toEqual({
        after:
          "# Pilot\n\nThe pilot runs for eight weeks.\n\nBudget is open.\n\nWe report every Friday.\n",
        current:
          "# Pilot\n\nThe pilot runs for eight weeks.\n\nBudget is fixed.\n\nWe report every Friday.\n",
      });
    });

    it("removes a final newline the turn added when the run reaches the end of the note", () => {
      const run: DiffRun = { before: { start: 1, end: 2 }, after: { start: 1, end: 3 } };

      expect(revokeRun("a\nb", "a\nb\n", "a\nb\n", run)).toEqual({
        after: "a\nb",
        current: "a\nb",
      });
    });

    it("changes nothing when the run's text changed in the note after the turn", () => {
      const current = AFTER.replace("eight weeks", "nine weeks");

      expect(revokeRun(BEFORE, AFTER, current, FIRST_RUN)).toBeNull();
    });
  });
});
