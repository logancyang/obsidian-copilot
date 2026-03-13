import { computeWordOverlap, findDuplicateQuery, stripLeakedRoleLines } from "./queryDeduplication";

describe("computeWordOverlap", () => {
  it("returns 1 for identical strings", () => {
    expect(computeWordOverlap("hello world", "hello world")).toBe(1);
  });

  it("returns 1 for both empty strings", () => {
    expect(computeWordOverlap("", "")).toBe(1);
  });

  it("returns 0 when one string is empty", () => {
    expect(computeWordOverlap("hello", "")).toBe(0);
    expect(computeWordOverlap("", "hello")).toBe(0);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(computeWordOverlap("hello world", "foo bar")).toBe(0);
  });

  it("is case insensitive", () => {
    expect(computeWordOverlap("Hello World", "hello world")).toBe(1);
  });

  it("computes correct Jaccard similarity for partial overlap", () => {
    // "paul graham mistakes" vs "paul graham errors"
    // intersection: {paul, graham} = 2, union: {paul, graham, mistakes, errors} = 4
    expect(computeWordOverlap("paul graham mistakes", "paul graham errors")).toBe(0.5);
  });

  it("catches inflection variants with sufficient shared context", () => {
    // "Paul Graham mistake founders" vs "Paul Graham mistakes founders"
    // intersection: {paul, graham, founders} = 3, union: {paul, graham, mistake, founders, mistakes} = 5
    const overlap = computeWordOverlap(
      "Paul Graham mistake founders",
      "Paul Graham mistakes founders"
    );
    expect(overlap).toBe(0.6);
  });

  it("handles duplicate words in input", () => {
    // Sets deduplicate, so "hello hello" -> {"hello"}
    expect(computeWordOverlap("hello hello", "hello")).toBe(1);
  });
});

describe("findDuplicateQuery", () => {
  it("returns null for empty previous queries", () => {
    expect(findDuplicateQuery("hello world", [])).toBeNull();
  });

  it("finds exact duplicate", () => {
    expect(findDuplicateQuery("hello world", ["hello world"])).toBe("hello world");
  });

  it("finds near-duplicate above threshold", () => {
    const previous = ["Paul Graham mistake founders"];
    const result = findDuplicateQuery("Paul Graham mistakes founders", previous);
    expect(result).toBe("Paul Graham mistake founders");
  });

  it("returns null when below threshold", () => {
    const previous = ["completely different query about cooking"];
    expect(findDuplicateQuery("Paul Graham mistakes founders", previous)).toBeNull();
  });

  it("returns first match when multiple duplicates exist", () => {
    const previous = ["search query alpha beta", "search query alpha gamma"];
    const result = findDuplicateQuery("search query alpha beta", previous);
    expect(result).toBe("search query alpha beta");
  });

  it("respects custom threshold", () => {
    // overlap = 0.5, default threshold catches it
    const previous = ["paul graham mistakes"];
    expect(findDuplicateQuery("paul graham errors", previous, 0.5)).toBe("paul graham mistakes");
    // Higher threshold misses it
    expect(findDuplicateQuery("paul graham errors", previous, 0.6)).toBeNull();
  });
});

describe("stripLeakedRoleLines", () => {
  it("strips bare 'user' lines", () => {
    // "user\n\nHello" splits to ["user", "", "Hello"] -> filter removes "user" -> "\nHello"
    expect(stripLeakedRoleLines("user\n\nHello")).toBe("\nHello");
  });

  it("strips bare 'assistant' lines", () => {
    expect(stripLeakedRoleLines("assistant\nI will help")).toBe("I will help");
  });

  it("strips bare 'system' lines", () => {
    expect(stripLeakedRoleLines("system\nYou are helpful")).toBe("You are helpful");
  });

  it("strips multiple role lines from real model output", () => {
    // Real case: "user\n\nuser\n Paul Graham" -> removes both "user" lines
    expect(stripLeakedRoleLines("user\n\nuser\n Paul Graham")).toBe("\n Paul Graham");
  });

  it("preserves 'user' when part of longer text", () => {
    expect(stripLeakedRoleLines("The user asked about this")).toBe("The user asked about this");
  });

  it("preserves 'assistant' in normal sentences", () => {
    expect(stripLeakedRoleLines("My assistant helped me")).toBe("My assistant helped me");
  });

  it("is case sensitive (only strips lowercase)", () => {
    expect(stripLeakedRoleLines("User\nHello")).toBe("User\nHello");
  });

  it("handles empty and null-ish input", () => {
    expect(stripLeakedRoleLines("")).toBe("");
    expect(stripLeakedRoleLines("   ")).toBe("   ");
  });

  it("preserves indented role words (code safety)", () => {
    // Indented "system" or "user" in code should NOT be stripped
    expect(stripLeakedRoleLines("  user  \nHello")).toBe("  user  \nHello");
  });

  it("strips role word with trailing whitespace at column 0", () => {
    expect(stripLeakedRoleLines("user  \nHello")).toBe("Hello");
  });
});
