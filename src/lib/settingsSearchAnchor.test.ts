import {
  SETTINGS_SEARCH_ANCHOR_ATTR,
  settingsSearchAnchor,
  settingsSearchAnchorAttrs,
} from "@/lib/settingsSearchAnchor";

describe("settingsSearchAnchor", () => {
  describe("settingsSearchAnchor()", () => {
    it("lowercases the title and collapses separator runs into single hyphens", () => {
      expect(settingsSearchAnchor("LLM & embedding models")).toBe("llm-embedding-models");
    });

    it("strips leading and trailing separators", () => {
      expect(settingsSearchAnchor("(advanced) Remote server!")).toBe("advanced-remote-server");
    });
  });

  describe("settingsSearchAnchorAttrs()", () => {
    it("derives the anchor attribute from a string title", () => {
      expect(settingsSearchAnchorAttrs("Debug Mode")).toEqual({
        [SETTINGS_SEARCH_ANCHOR_ATTR]: "debug-mode",
      });
    });

    it("returns undefined for empty or non-string titles", () => {
      expect(settingsSearchAnchorAttrs("")).toBeUndefined();
      expect(settingsSearchAnchorAttrs(undefined)).toBeUndefined();
      expect(settingsSearchAnchorAttrs({ node: true })).toBeUndefined();
    });
  });
});
