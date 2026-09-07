import { legacyOpencodeModelIds, normalizeOpencodeSelection } from "./opencodeModelMigration";
import type { ModelEntry } from "@/agentMode/session/types";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/219";
const entries = (...ids: string[]): ModelEntry[] =>
  ids.map((baseModelId) => ({
    baseModelId,
    name: baseModelId,
    provider: null,
    effortOptions: [],
  }));

describe("opencodeModelMigration", () => {
  describe("legacyOpencodeModelIds()", () => {
    it(`identifies every literal variant of a historically grouped row (${issue})`, () => {
      expect(legacyOpencodeModelIds(["anthropic/vendor/high", "anthropic/vendor/low"])).toEqual(
        new Map([
          ["anthropic/vendor/high", "anthropic/vendor"],
          ["anthropic/vendor/low", "anthropic/vendor"],
        ])
      );
    });
    it(`does not alias real bases, arbitrary names, or two-segment IDs (${issue})`, () => {
      expect(
        legacyOpencodeModelIds([
          "anthropic/vendor",
          "anthropic/vendor/high",
          "anthropic/high",
          "anthropic/vendor/future",
        ])
      ).toEqual(new Map());
    });
  });
  describe("normalizeOpencodeSelection()", () => {
    it(`uses the explicit saved suffix when several literal variants exist (${issue})`, () => {
      expect(
        normalizeOpencodeSelection(
          { baseModelId: "anthropic/vendor", effort: "low" },
          entries("anthropic/vendor/high", "anthropic/vendor/low")
        )
      ).toEqual({ baseModelId: "anthropic/vendor/low", effort: null });
    });
    it.each([
      { effort: null, catalog: ["anthropic/vendor/high"] },
      { effort: "high", catalog: ["anthropic/vendor", "anthropic/vendor/high"] },
      { effort: "high", catalog: [] },
    ])(
      `preserves unresolved or already-valid selections by reference: $effort / $catalog (${issue})`,
      ({ effort, catalog }) => {
        const selection = { baseModelId: "anthropic/vendor", effort };
        expect(normalizeOpencodeSelection(selection, entries(...catalog))).toBe(selection);
      }
    );
  });
});
