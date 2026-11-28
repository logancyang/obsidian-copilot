import { formatCodexModelId, parseCodexModelId } from "./codexModelId";

describe("codexModelId", () => {
  describe("parseCodexModelId()", () => {
    it.each([
      ["gpt-5.6-sol[low]", "gpt-5.6-sol", "low"],
      ["gpt-5.6-sol[xhigh]", "gpt-5.6-sol", "xhigh"],
      ["gpt-5.6-sol[max]", "gpt-5.6-sol", "max"],
      ["gpt-5.6-sol[ultra]", "gpt-5.6-sol", "ultra"],
      ["gpt-5.3-codex-spark[medium]", "gpt-5.3-codex-spark", "medium"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 splits %s into its base model and effort",
      (wireId, baseModelId, effort) => {
        expect(parseCodexModelId(wireId)).toEqual({ baseModelId, effort });
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 accepts an effort token the plugin has never seen, so a new CLI level needs no change", () => {
      expect(parseCodexModelId("gpt-6[hyper]")).toEqual({
        baseModelId: "gpt-6",
        effort: "hyper",
      });
    });

    it.each(["gpt[[high]", "gpt[low][high]", "gpt]name[high]"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 preserves malformed bracketed ID %s",
      (wireId) => {
        expect(parseCodexModelId(wireId)).toEqual({ baseModelId: wireId, effort: null });
      }
    );

    it.each([
      ["gpt-5.6-sol", "a bare model id"],
      ["", "an empty id"],
      ["gpt-5.6-sol[]", "an empty bracket group"],
      ["gpt-5.6-sol[low] ", "a bracket group that isn't trailing"],
      ["[low]", "brackets with no base model"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 reports %s (%s) as effortless and keeps it whole",
      (wireId) => {
        expect(parseCodexModelId(wireId)).toEqual({ baseModelId: wireId, effort: null });
      }
    );
  });

  describe("formatCodexModelId()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 brackets the effort onto the base model", () => {
      expect(formatCodexModelId("gpt-5.6-sol", "ultra")).toBe("gpt-5.6-sol[ultra]");
    });

    it.each([null, ""])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 rejects missing effort %p before sending an unsupported model ID",
      (effort) => {
        expect(() => formatCodexModelId("gpt-5.6-sol", effort)).toThrow(
          "Choose an explicit effort"
        );
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 round-trips every advertised wire id", () => {
      for (const wireId of ["gpt-5.6-sol[low]", "gpt-5.5[xhigh]", "gpt-5.4-mini[medium]"]) {
        const { baseModelId, effort } = parseCodexModelId(wireId);
        expect(formatCodexModelId(baseModelId, effort)).toBe(wireId);
      }
    });
  });
});
