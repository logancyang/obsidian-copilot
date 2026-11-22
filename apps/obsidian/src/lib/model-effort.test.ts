import { resolveEffort, sortEffortOptions } from "@/lib/model-effort";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/219";
const options = ["high", "low", "medium"].map((value) => ({ value, label: value }));

describe("model-effort", () => {
  describe("resolveEffort()", () => {
    it(`${issue} retains an advertised preference`, () => {
      expect(resolveEffort("high", options)).toBe("high");
    });
    it.each([null, undefined, "removed"])(
      `${issue} replaces missing or invalid effort %p with the lowest supported level`,
      (value) => {
        expect(resolveEffort(value, options)).toBe("low");
      }
    );
    it(`${issue} omits effort for models with no concrete choices`, () => {
      expect(resolveEffort("high", [])).toBeNull();
      expect(resolveEffort("high", [{ value: null, label: "Default" }])).toBeNull();
    });
    it(`${issue} preserves intent while discovery is unavailable`, () => {
      expect(resolveEffort("high", undefined)).toBe("high");
      expect(resolveEffort(undefined, undefined)).toBeNull();
    });
  });
  describe("sortEffortOptions()", () => {
    it(`${issue} excludes agent-default choices and ranks concrete levels without mutating the catalog`, () => {
      const input = [{ value: null, label: "Default" }, ...options];
      expect(sortEffortOptions(input).map((option) => option.value)).toEqual([
        "low",
        "medium",
        "high",
      ]);
      expect(input[0].value).toBeNull();
    });
    it(`${issue} retains unknown levels in backend order after known levels`, () => {
      expect(
        sortEffortOptions(["ultra", "future", "low"].map((value) => ({ value, label: value }))).map(
          (option) => option.value
        )
      ).toEqual(["low", "ultra", "future"]);
    });
    it(`${issue} reuses an empty list for models without effort controls`, () => {
      expect(sortEffortOptions([])).toBe(sortEffortOptions([{ value: null, label: "Default" }]));
    });
  });
});
