import { compactBySection, truncateWithEllipsis, escapeXmlAttr } from "./compactionUtils";

describe("compactionUtils", () => {
  describe("truncateWithEllipsis()", () => {
    it("returns text at or under maxLength unchanged", () => {
      expect(truncateWithEllipsis("Short.", 100)).toBe("Short.");
    });

    it("cuts at the last sentence boundary past the halfway point and appends an ellipsis", () => {
      const text =
        "First sentence. Second sentence. Third sentence that goes on and on to make it longer.";
      const result = truncateWithEllipsis(text, 50);
      expect(result).toContain("First sentence.");
      expect(result).toContain("Second sentence.");
      expect(result.endsWith("...")).toBe(true);
      expect(result.length).toBeLessThan(text.length);
    });

    it("cuts at a paragraph break when there is no sentence boundary", () => {
      const text = "First paragraph with no sentence breaks\n\nSecond paragraph here";
      expect(truncateWithEllipsis(text, 50)).toBe("First paragraph with no sentence breaks\n\n...");
    });

    it("cuts at a word boundary when there is no sentence or paragraph boundary", () => {
      const text = "word1 word2 word3 word4 word5 word6 word7 word8";
      expect(truncateWithEllipsis(text, 25)).toBe("word1 word2 word3 word4 ...");
    });

    it("hard-cuts at maxLength and appends an ellipsis when the text has no break points", () => {
      expect(truncateWithEllipsis("verylongwordwithoutanyspaces", 10)).toBe("verylongwo...");
    });
  });

  describe("compactBySection()", () => {
    it("keeps sections within the preview budget verbatim", () => {
      const content = `## Section 1
Short content.

## Section 2
Also short.`;
      expect(compactBySection(content, 500, 20)).toBe(content);
    });

    it("keeps every heading, including nested levels, while truncating long section bodies", () => {
      const content = `# Main Title
${"A".repeat(1000)}

## Section 1
Content for section 1.

### Subsection 1.1
${"B".repeat(1000)}`;
      const result = compactBySection(content, 100, 20);
      expect(result).toContain("# Main Title");
      expect(result).toContain("## Section 1");
      expect(result).toContain("### Subsection 1.1");
      expect(result).toContain("Content for section 1.");
      expect(result.length).toBeLessThan(content.length / 2);
    });

    it("keeps the first maxSections sections and reports how many were omitted", () => {
      const sections = Array.from({ length: 30 }, (_, i) => `## Section ${i}\nContent`);
      const result = compactBySection(sections.join("\n\n"), 500, 10);
      expect(result).toContain("## Section 0");
      expect(result).toContain("## Section 9");
      expect(result).not.toContain("## Section 10");
      expect(result).toContain("[... 20 more sections omitted ...]");
    });

    it("truncates content without headings to four times the preview budget", () => {
      const content = "A".repeat(5000);
      const result = compactBySection(content, 500, 20);
      expect(result).toBe(`${"A".repeat(2000)}...`);
    });
  });

  describe("escapeXmlAttr()", () => {
    it("escapes quotes, ampersands, angle brackets, and apostrophes", () => {
      expect(escapeXmlAttr('test "quoted"')).toBe("test &quot;quoted&quot;");
      expect(escapeXmlAttr("test & ampersand")).toBe("test &amp; ampersand");
      expect(escapeXmlAttr("test <tag>")).toBe("test &lt;tag&gt;");
      expect(escapeXmlAttr("test 'apostrophe'")).toBe("test &apos;apostrophe&apos;");
    });

    it("returns an empty string unchanged", () => {
      expect(escapeXmlAttr("")).toBe("");
    });
  });
});
