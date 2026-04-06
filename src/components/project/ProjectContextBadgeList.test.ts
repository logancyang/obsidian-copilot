import { buildBadgeItems, removePattern } from "./ProjectContextBadgeList";

describe("buildBadgeItems", () => {
  it("returns empty array for empty/undefined input", () => {
    expect(buildBadgeItems("")).toEqual([]);
    expect(buildBadgeItems(undefined)).toEqual([]);
  });

  it("categorizes patterns by type", () => {
    // Encoded: folder, #tag, [[note]], *.pdf
    const value = "my-folder,%23tag,%5B%5Bnote%5D%5D,*.pdf";
    const items = buildBadgeItems(value);

    expect(items).toEqual([
      { pattern: "my-folder", type: "folder" },
      { pattern: "#tag", type: "tag" },
      { pattern: "[[note]]", type: "note" },
      { pattern: "*.pdf", type: "extension" },
    ]);
  });

  it("deduplicates patterns", () => {
    const value = "my-folder,my-folder";
    const items = buildBadgeItems(value);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ pattern: "my-folder", type: "folder" });
  });

  it("handles multiple patterns of the same type", () => {
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

describe("removePattern", () => {
  it("removes a folder pattern", () => {
    const value = "folder-a,folder-b,%23tag1";
    const result = removePattern(value, "folder-a", "folder");

    expect(result).toContain("folder-b");
    expect(result).toContain("%23tag1");
    expect(result).not.toContain(encodeURIComponent("folder-a"));
  });

  it("removes a tag pattern", () => {
    const value = "%23tag1,%23tag2,my-folder";
    const result = removePattern(value, "#tag1", "tag");

    expect(result).toContain("%23tag2");
    expect(result).toContain("my-folder");
    // Verify #tag1 is gone — check decoded result doesn't include it
    const remaining = decodeURIComponent(result);
    expect(remaining).not.toContain("#tag1");
  });

  it("removes a note pattern", () => {
    const value = "%5B%5Bnote%5D%5D,my-folder";
    const result = removePattern(value, "[[note]]", "note");

    expect(result).toContain("my-folder");
    expect(result).not.toContain("%5B%5Bnote%5D%5D");
  });

  it("removes an extension pattern", () => {
    const value = "*.pdf,my-folder";
    const result = removePattern(value, "*.pdf", "extension");

    expect(result).toContain("my-folder");
    expect(result).not.toContain("*.pdf");
  });

  it("returns empty string when removing the last pattern", () => {
    const value = "my-folder";
    const result = removePattern(value, "my-folder", "folder");

    expect(result).toBe("");
  });

  it("handles undefined input", () => {
    const result = removePattern(undefined, "my-folder", "folder");
    expect(result).toBe("");
  });
});
