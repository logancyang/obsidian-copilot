import { formatCodexModelId, parseCodexModelId } from "./codexModelId";

describe("codexModelId", () => {
  describe("parseCodexModelId()", () => {
    it.each([
      ["gpt-5.6-sol[low]", "gpt-5.6-sol", "low"],
      ["gpt-5.6-sol[xhigh]", "gpt-5.6-sol", "xhigh"],
      ["gpt-5.6-sol[max]", "gpt-5.6-sol", "max"],
      ["gpt-5.6-sol[ultra]", "gpt-5.6-sol", "ultra"],
      ["gpt-5.3-codex-spark[medium]", "gpt-5.3-codex-spark", "medium"],
    ])("splits %s into its base model and effort", (wireId, baseModelId, effort) => {
      expect(parseCodexModelId(wireId)).toEqual({ baseModelId, effort });
    });

    it("accepts an effort token the plugin has never seen, so a new CLI level needs no change", () => {
      expect(parseCodexModelId("gpt-6[hyper]")).toEqual({
        baseModelId: "gpt-6",
        effort: "hyper",
      });
    });

    it.each([
      ["gpt-5.6-sol", "a bare model id"],
      ["", "an empty id"],
      ["gpt-5.6-sol[]", "an empty bracket group"],
      ["gpt-5.6-sol[low] ", "a bracket group that isn't trailing"],
      ["[low]", "brackets with no base model"],
    ])("reports %s (%s) as effortless and keeps it whole", (wireId) => {
      expect(parseCodexModelId(wireId)).toEqual({ baseModelId: wireId, effort: null });
    });
  });

  describe("formatCodexModelId()", () => {
    it("brackets the effort onto the base model", () => {
      expect(formatCodexModelId("gpt-5.6-sol", "ultra")).toBe("gpt-5.6-sol[ultra]");
    });

    it("emits the bare base model when no effort is selected", () => {
      expect(formatCodexModelId("gpt-5.6-sol", null)).toBe("gpt-5.6-sol");
    });

    it("round-trips every advertised wire id", () => {
      for (const wireId of ["gpt-5.6-sol[low]", "gpt-5.5[xhigh]", "gpt-5.4-mini[medium]"]) {
        const { baseModelId, effort } = parseCodexModelId(wireId);
        expect(formatCodexModelId(baseModelId, effort)).toBe(wireId);
      }
    });
  });
});
