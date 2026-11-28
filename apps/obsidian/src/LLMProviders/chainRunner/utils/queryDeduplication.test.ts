import { computeWordOverlap, findDuplicateQuery, stripLeakedRoleLines } from "./queryDeduplication";

describe("queryDeduplication", () => {
  describe("computeWordOverlap()", () => {
    it("returns 1 for identical strings", () => {
      expect(computeWordOverlap("hello world", "hello world")).toBe(1);
    });

    it("ignores case and repeated words", () => {
      expect(computeWordOverlap("Hello World", "hello world")).toBe(1);
      expect(computeWordOverlap("hello hello", "hello")).toBe(1);
    });

    it("scores partial overlap as shared words over the word count of the shorter string", () => {
      expect(computeWordOverlap("paul graham mistakes", "paul graham errors")).toBeCloseTo(
        0.667,
        2
      );
    });

    it("scores a one-word inflection difference in a four-word query as 0.75", () => {
      expect(
        computeWordOverlap("Paul Graham mistake founders", "Paul Graham mistakes founders")
      ).toBe(0.75);
    });

    it("scores a short query contained in a longer refinement as a high overlap", () => {
      expect(
        computeWordOverlap("Paul Graham getting rich", "Paul Graham essay how to get rich")
      ).toBe(0.75);
      expect(computeWordOverlap("python", "python tutorial beginners")).toBe(1);
    });

    it("returns 0 for completely disjoint strings", () => {
      expect(computeWordOverlap("hello world", "foo bar")).toBe(0);
    });

    it("returns 1 when both strings are empty and 0 when only one is", () => {
      expect(computeWordOverlap("", "")).toBe(1);
      expect(computeWordOverlap("hello", "")).toBe(0);
      expect(computeWordOverlap("", "hello")).toBe(0);
    });
  });

  describe("findDuplicateQuery()", () => {
    it("returns the previous query that exactly matches", () => {
      expect(findDuplicateQuery("hello world", ["hello world"])).toBe("hello world");
    });

    it("returns the previous query that is a near-duplicate above the default threshold", () => {
      expect(
        findDuplicateQuery("Paul Graham mistakes founders", ["Paul Graham mistake founders"])
      ).toBe("Paul Graham mistake founders");
    });

    it("returns the first previous query that matches when several match", () => {
      const previous = ["search query alpha beta", "search query alpha gamma"];

      expect(findDuplicateQuery("search query alpha beta", previous)).toBe(
        "search query alpha beta"
      );
    });

    it("returns null when no previous query exists", () => {
      expect(findDuplicateQuery("hello world", [])).toBeNull();
    });

    it("returns null when every previous query is below the threshold", () => {
      expect(
        findDuplicateQuery("Paul Graham mistakes founders", [
          "completely different query about cooking",
        ])
      ).toBeNull();
    });
  });

  describe("stripLeakedRoleLines()", () => {
    it.each(["user", "assistant", "system"])("strips a bare %s line", (role) => {
      expect(stripLeakedRoleLines(`${role}\nHello`)).toBe("Hello");
    });

    it("strips every role line from model output that leaks several", () => {
      expect(stripLeakedRoleLines("user\n\nuser\n Paul Graham")).toBe("\n Paul Graham");
    });

    it("strips a role word followed by trailing whitespace at column 0", () => {
      expect(stripLeakedRoleLines("user  \nHello")).toBe("Hello");
    });

    it("keeps role words inside longer text", () => {
      expect(stripLeakedRoleLines("The user asked about this")).toBe("The user asked about this");
      expect(stripLeakedRoleLines("My assistant helped me")).toBe("My assistant helped me");
    });

    it("keeps capitalized and indented role words", () => {
      expect(stripLeakedRoleLines("User\nHello")).toBe("User\nHello");
      expect(stripLeakedRoleLines("  user  \nHello")).toBe("  user  \nHello");
    });

    it("returns empty and blank input unchanged", () => {
      expect(stripLeakedRoleLines("")).toBe("");
      expect(stripLeakedRoleLines("   ")).toBe("   ");
    });
  });
});
