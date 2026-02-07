import {
  compactBySection,
  truncateWithEllipsis,
  escapeXmlAttr,
  mergeConfig,
  DEFAULT_COMPACTION_CONFIG,
} from "./compactionUtils";

describe("compactionUtils", () => {
  describe("DEFAULT_COMPACTION_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_COMPACTION_CONFIG.previewCharsPerSection).toBe(500);
      expect(DEFAULT_COMPACTION_CONFIG.maxSections).toBe(20);
      expect(DEFAULT_COMPACTION_CONFIG.verbatimThreshold).toBe(5000);
    });
  });

  describe("mergeConfig", () => {
    it("should use defaults when no config provided", () => {
      const config = mergeConfig();
      expect(config).toEqual(DEFAULT_COMPACTION_CONFIG);
    });

    it("should override specific values", () => {
      const config = mergeConfig({ previewCharsPerSection: 100 });
      expect(config.previewCharsPerSection).toBe(100);
      expect(config.maxSections).toBe(DEFAULT_COMPACTION_CONFIG.maxSections);
    });
  });

  describe("truncateWithEllipsis", () => {
    it("should return text unchanged if under maxLength", () => {
      expect(truncateWithEllipsis("Short.", 100)).toBe("Short.");
    });

    it("should truncate at sentence boundary when possible", () => {
      const text = "First sentence. Second sentence. Third sentence is much longer.";
      const result = truncateWithEllipsis(text, 50);
      expect(result).toContain("First sentence.");
      expect(result).toContain("...");
    });

    it("should truncate at word boundary as fallback", () => {
      const text = "word1 word2 word3 word4 word5";
      const result = truncateWithEllipsis(text, 20);
      expect(result).toContain("...");
      expect(result.length).toBeLessThanOrEqual(25); // 20 + ellipsis
    });
  });

  describe("compactBySection", () => {
    it("should preserve all headings", () => {
      const content = `## Section 1
Content 1

## Section 2
Content 2`;
      const result = compactBySection(content, 500, 20);
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
    });

    it("should truncate long sections", () => {
      const content = `## Section 1
${"A".repeat(1000)}`;
      const result = compactBySection(content, 100, 20);
      expect(result).toContain("## Section 1");
      expect(result.length).toBeLessThan(content.length);
    });

    it("should limit number of sections", () => {
      const sections = Array.from({ length: 30 }, (_, i) => `## Section ${i}\nContent`);
      const content = sections.join("\n\n");
      const result = compactBySection(content, 500, 10);
      expect(result).toContain("## Section 0");
      expect(result).toContain("## Section 9");
      expect(result).not.toContain("## Section 10");
      expect(result).toContain("more sections omitted");
    });

    it("should handle content without headings", () => {
      const content = "A".repeat(5000);
      const result = compactBySection(content, 500, 20);
      expect(result.length).toBeLessThan(content.length);
      expect(result).toContain("...");
    });
  });

  describe("escapeXmlAttr", () => {
    it("should escape special XML characters", () => {
      expect(escapeXmlAttr('test "quoted"')).toBe("test &quot;quoted&quot;");
      expect(escapeXmlAttr("test & ampersand")).toBe("test &amp; ampersand");
      expect(escapeXmlAttr("test <tag>")).toBe("test &lt;tag&gt;");
      expect(escapeXmlAttr("test 'apostrophe'")).toBe("test &apos;apostrophe&apos;");
    });

    it("should handle empty string", () => {
      expect(escapeXmlAttr("")).toBe("");
    });
  });
});
