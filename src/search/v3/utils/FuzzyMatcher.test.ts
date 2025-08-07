import { FuzzyMatcher } from "./FuzzyMatcher";

describe("FuzzyMatcher", () => {
  describe("levenshteinDistance", () => {
    it("should return 0 for identical strings", () => {
      expect(FuzzyMatcher.levenshteinDistance("hello", "hello")).toBe(0);
    });

    it("should handle empty strings", () => {
      expect(FuzzyMatcher.levenshteinDistance("", "")).toBe(0);
      expect(FuzzyMatcher.levenshteinDistance("hello", "")).toBe(5);
      expect(FuzzyMatcher.levenshteinDistance("", "world")).toBe(5);
    });

    it("should calculate correct distance for single character changes", () => {
      expect(FuzzyMatcher.levenshteinDistance("cat", "bat")).toBe(1); // substitution
      expect(FuzzyMatcher.levenshteinDistance("cat", "cats")).toBe(1); // insertion
      expect(FuzzyMatcher.levenshteinDistance("cats", "cat")).toBe(1); // deletion
    });

    it("should calculate correct distance for multiple changes", () => {
      expect(FuzzyMatcher.levenshteinDistance("kitten", "sitting")).toBe(3);
      expect(FuzzyMatcher.levenshteinDistance("saturday", "sunday")).toBe(3);
    });
  });

  describe("similarity", () => {
    it("should return 1 for identical strings", () => {
      expect(FuzzyMatcher.similarity("hello", "hello")).toBe(1);
    });

    it("should be case insensitive", () => {
      expect(FuzzyMatcher.similarity("Hello", "hello")).toBe(1);
      expect(FuzzyMatcher.similarity("WORLD", "world")).toBe(1);
    });

    it("should return correct similarity scores", () => {
      expect(FuzzyMatcher.similarity("cat", "bat")).toBeCloseTo(0.667, 2);
      expect(FuzzyMatcher.similarity("hello", "hallo")).toBe(0.8);
      expect(FuzzyMatcher.similarity("piano", "pianos")).toBeCloseTo(0.833, 2);
    });

    it("should return 0 for completely different strings", () => {
      expect(FuzzyMatcher.similarity("abc", "xyz")).toBe(0);
    });
  });

  describe("generateVariants", () => {
    it("should generate case variants", () => {
      const variants = FuzzyMatcher.generateVariants("note");
      expect(variants).toContain("note");
      expect(variants).toContain("NOTE");
      expect(variants).toContain("Note");
    });

    it("should generate plural/singular variants", () => {
      const pluralVariants = FuzzyMatcher.generateVariants("notes");
      expect(pluralVariants).toContain("note");

      const singularVariants = FuzzyMatcher.generateVariants("note");
      expect(singularVariants).toContain("notes");

      const yVariants = FuzzyMatcher.generateVariants("query");
      expect(yVariants).toContain("queries");
    });

    it("should handle multi-word terms with different casings", () => {
      const variants = FuzzyMatcher.generateVariants("piano notes");
      expect(variants).toContain("piano notes");
      expect(variants).toContain("PIANO NOTES");
      expect(variants).toContain("Piano notes");
      expect(variants).toContain("pianoNotes"); // camelCase
      expect(variants).toContain("PianoNotes"); // PascalCase
    });

    it("should handle hyphenated terms", () => {
      const variants = FuzzyMatcher.generateVariants("full-text");
      expect(variants).toContain("fullText"); // camelCase
      expect(variants).toContain("FullText"); // PascalCase
    });

    it("should handle underscored terms", () => {
      const variants = FuzzyMatcher.generateVariants("search_query");
      expect(variants).toContain("searchQuery"); // camelCase
      expect(variants).toContain("SearchQuery"); // PascalCase
    });

    it("should generate keyboard proximity variants", () => {
      const variants = FuzzyMatcher.generateVariants("test");
      // 't' can be replaced with 'r' or 'y' based on keyboard proximity
      const hasKeyboardVariant = variants.some(
        (v) => v.includes("rest") || v.includes("yest") || v.includes("tesr")
      );
      expect(hasKeyboardVariant).toBe(true);
    });

    it("should limit the number of variants", () => {
      const variants = FuzzyMatcher.generateVariants("test");
      expect(variants.length).toBeLessThanOrEqual(15); // Reasonable limit
    });
  });

  describe("isFuzzyMatch", () => {
    it("should match identical strings", () => {
      expect(FuzzyMatcher.isFuzzyMatch("hello", "hello")).toBe(true);
    });

    it("should match with case differences", () => {
      expect(FuzzyMatcher.isFuzzyMatch("Hello", "hello")).toBe(true);
      expect(FuzzyMatcher.isFuzzyMatch("WORLD", "world")).toBe(true);
    });

    it("should match similar strings with default threshold", () => {
      expect(FuzzyMatcher.isFuzzyMatch("color", "colour")).toBe(true); // 0.833 similarity
      expect(FuzzyMatcher.isFuzzyMatch("gray", "grey")).toBe(false); // 0.5 similarity
    });

    it("should respect custom threshold", () => {
      expect(FuzzyMatcher.isFuzzyMatch("gray", "grey", 0.5)).toBe(true);
      expect(FuzzyMatcher.isFuzzyMatch("gray", "grey", 0.76)).toBe(false); // gray/grey similarity is 0.75
    });

    it("should handle plurals", () => {
      expect(FuzzyMatcher.isFuzzyMatch("note", "notes", 0.8)).toBe(true);
      expect(FuzzyMatcher.isFuzzyMatch("query", "queries", 0.6)).toBe(true); // queries is 2 char diff, ~0.67 similarity
    });
  });
});
