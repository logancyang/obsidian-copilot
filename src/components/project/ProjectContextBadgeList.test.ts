import { buildBadgeItems, getBadgeLabel, removePattern } from "./ProjectContextBadgeList";

describe("ProjectContextBadgeList", () => {
  describe("buildBadgeItems()", () => {
    it("returns empty array for empty/undefined input", () => {
      expect(buildBadgeItems("")).toEqual([]);
      expect(buildBadgeItems(undefined)).toEqual([]);
    });

    it("categorizes patterns by type", () => {
      const value =
        "my-folder,%23tag,%5B%5Bnote%5D%5D,*.pdf,%5BTopics%3APhysics%5D,%5BTopics%3A%5D";
      const items = buildBadgeItems(value);

      expect(items).toEqual([
        { pattern: "my-folder", type: "folder" },
        { pattern: "#tag", type: "tag" },
        { pattern: "[[note]]", type: "note" },
        { pattern: "*.pdf", type: "extension" },
        { pattern: "[Topics:Physics]", type: "property" },
        { pattern: "[Topics:]", type: "property" },
      ]);
    });

    it("deduplicates patterns", () => {
      const value = "my-folder,my-folder";
      const items = buildBadgeItems(value);

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ pattern: "my-folder", type: "folder" });
    });

    it("keeps each type's patterns in input order, grouped by type", () => {
      const value = "folder-a,folder-b,%23tag1,%23tag2";
      const items = buildBadgeItems(value);

      expect(items).toEqual([
        { pattern: "folder-a", type: "folder" },
        { pattern: "folder-b", type: "folder" },
        { pattern: "#tag1", type: "tag" },
        { pattern: "#tag2", type: "tag" },
      ]);
    });
  });

  describe("removePattern()", () => {
    it.each([
      ["folder", "folder-a", "folder-a,folder-b,%23tag1", "%23tag1,folder-b"],
      ["tag", "#tag1", "%23tag1,%23tag2,my-folder", "%23tag2,my-folder"],
      ["note", "[[note]]", "%5B%5Bnote%5D%5D,my-folder", "my-folder"],
      ["extension", "*.pdf", "*.pdf,my-folder", "my-folder"],
      ["property", "[Topics:Physics]", "%5BTopics%3APhysics%5D,%23tag1", "%23tag1"],
    ] as const)(
      "removes only the %s pattern and keeps the others",
      (type, pattern, value, expected) => {
        expect(removePattern(value, pattern, type)).toBe(expected);
      }
    );

    it("returns empty string when removing the last pattern", () => {
      const value = "my-folder";
      const result = removePattern(value, "my-folder", "folder");

      expect(result).toBe("");
    });

    it("returns an empty string for undefined input", () => {
      const result = removePattern(undefined, "my-folder", "folder");
      expect(result).toBe("");
    });
  });

  describe("getBadgeLabel()", () => {
    it("renders a property pattern as `key: value`", () => {
      expect(getBadgeLabel({ pattern: "[Topics:Physics]", type: "property" })).toBe(
        "Topics: Physics"
      );
    });

    it("renders a key-only property pattern as `key: (any)`", () => {
      expect(getBadgeLabel({ pattern: "[Topics:]", type: "property" })).toBe("Topics: (any)");
    });

    it("returns the raw pattern for non-property types", () => {
      expect(getBadgeLabel({ pattern: "#tag", type: "tag" })).toBe("#tag");
      expect(getBadgeLabel({ pattern: "my-folder", type: "folder" })).toBe("my-folder");
    });

    it("falls back to the raw pattern when a property pattern cannot be parsed", () => {
      expect(getBadgeLabel({ pattern: "not-a-property", type: "property" })).toBe("not-a-property");
    });
  });
});
