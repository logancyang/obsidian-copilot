import {
  sanitizeContentForCitations,
  formatSourceCatalog,
  hasExistingCitations,
  getVaultCitationGuidance,
  getQACitationInstructions,
  processInlineCitations,
  getCitationInstructions,
  addFallbackSources,
  type SourceCatalogEntry,
} from "./citationUtils";

describe("citationUtils", () => {
  describe("sanitizeContentForCitations", () => {
    it("should remove footnote references", () => {
      const input = "This is text with [^1] and [^2] footnotes.";
      const result = sanitizeContentForCitations(input);
      expect(result).not.toContain("[^1]");
      expect(result).not.toContain("[^2]");
      expect(result).toContain("This is text with");
      expect(result).toContain("footnotes.");
    });

    it("should remove numeric citations but preserve markdown links", () => {
      const input = "Study shows [1] and see [this link](https://example.com) and [2, 3] results.";
      const result = sanitizeContentForCitations(input);
      expect(result).not.toContain("[1]");
      expect(result).not.toContain("[2, 3]");
      expect(result).toContain("[this link](https://example.com)");
    });

    it("should remove footnote definition lines", () => {
      const input = `Content here
[^1]: Source definition
More content
[^2]: Another source`;
      const result = sanitizeContentForCitations(input);
      expect(result).not.toContain("[^1]: Source definition");
      expect(result).not.toContain("[^2]: Another source");
      expect(result).toContain("Content here");
      expect(result).toContain("More content");
    });

    it("should handle edge cases", () => {
      expect(sanitizeContentForCitations("")).toBe("");
      expect(sanitizeContentForCitations(null as any)).toBe("");
      expect(sanitizeContentForCitations(undefined as any)).toBe("");
    });
  });

  describe("formatSourceCatalog", () => {
    it("should format sources with proper wikilink syntax", () => {
      const sources: SourceCatalogEntry[] = [
        { title: "Document 1", path: "path/to/doc1.md" },
        { title: "Document 2", path: "path/to/doc2.md" },
      ];
      const result = formatSourceCatalog(sources);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatch(/^- \[\[.*\]\] \(.*\)$/);
      expect(result[0]).toContain("Document 1");
      expect(result[0]).toContain("path/to/doc1.md");
    });

    it("should handle fallbacks for missing data", () => {
      const sources: SourceCatalogEntry[] = [
        { title: "", path: "path/to/doc.md" },
        { title: "Document", path: "" },
      ];
      const result = formatSourceCatalog(sources);

      expect(result[0]).toContain("path/to/doc.md");
      expect(result[1]).toContain("Document");
      expect(result).toHaveLength(2);
    });

    it("should handle empty input", () => {
      expect(formatSourceCatalog([])).toEqual([]);
    });
  });

  describe("hasExistingCitations", () => {
    it("should detect sources section", () => {
      const responseWithSources = "Some content\n#### Sources:\n[^1]: [[Doc]]";
      expect(hasExistingCitations(responseWithSources)).toBe(true);

      const responseWithSourcesColon = "Some content\nSources:\n[^1]: [[Doc]]";
      expect(hasExistingCitations(responseWithSourcesColon)).toBe(true);
    });

    it("should detect footnote definitions with wikilinks", () => {
      const responseWithFootnotes = "Some content\n[^1]: [[Document Name]]";
      expect(hasExistingCitations(responseWithFootnotes)).toBe(true);
    });

    it("should detect bare footnote definitions (regression test for duplicate sources)", () => {
      // This is the format that was causing duplicate sources sections
      const responseWithBareFootnotes =
        "Content here\n[^1]: [[How to Make Wealth]]\n[^2]: [[Superlinear Returns]]";
      expect(hasExistingCitations(responseWithBareFootnotes)).toBe(true);

      const responseWithFootnotesNoWikilinks =
        "Content here\n[^1]: How to Make Wealth\n[^2]: Superlinear Returns";
      expect(hasExistingCitations(responseWithFootnotesNoWikilinks)).toBe(true);
    });

    it("should detect footnotes at start of line with whitespace", () => {
      const responseWithIndentedFootnotes =
        "Content here\n   [^1]: [[Document]]\n  [^2]: [[Another]]";
      expect(hasExistingCitations(responseWithIndentedFootnotes)).toBe(true);
    });

    it("should NOT detect inline citations", () => {
      const responseWithInlineCitations = "This is a claim [^1] and another claim [^2].";
      expect(hasExistingCitations(responseWithInlineCitations)).toBe(false);
    });

    it("should return false for responses without citations", () => {
      const responseWithoutCitations = "Just regular content here";
      expect(hasExistingCitations(responseWithoutCitations)).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(hasExistingCitations("")).toBe(false);
      expect(hasExistingCitations(null as any)).toBe(false);
      expect(hasExistingCitations(undefined as any)).toBe(false);
    });

    it("should handle the exact format from user's example", () => {
      const userExample = `Content here

[^1]: [[How to Make Wealth]]
[^2]: [[Superlinear Returns]]

#### Sources
[^1]: [[How to Make Wealth]]
[^2]: [[Superlinear Returns]]`;
      expect(hasExistingCitations(userExample)).toBe(true);
    });
  });

  describe("getVaultCitationGuidance", () => {
    it("should format vault citation guidance with source catalog", () => {
      const sourceCatalog = ["- [[Doc 1]] (path1.md)", "- [[Doc 2]] (path2.md)"];
      const result = getVaultCitationGuidance(sourceCatalog);

      expect(result).toContain("<guidance>");
      expect(result).toContain("</guidance>");
      expect(result).toContain("CITATION RULES:");
      expect(result).toContain("START with [^1]");
      expect(result).toContain("Source Catalog (for reference only):");
      expect(result).toContain("- [[Doc 1]] (path1.md)");
      expect(result).toContain("- [[Doc 2]] (path2.md)");
    });
  });

  describe("getQACitationInstructions", () => {
    it("should format QA citation instructions with source catalog", () => {
      const sourceCatalog = "- [[Doc 1]]\n- [[Doc 2]]";
      const result = getQACitationInstructions(sourceCatalog);

      expect(result).toContain("CITATION RULES:");
      expect(result).toContain("START with [^1]");
      expect(result).toContain("Source Catalog (for reference only):");
      expect(result).toContain("- [[Doc 1]]");
      expect(result).toContain("- [[Doc 2]]");
    });
  });

  describe("processInlineCitations", () => {
    it("should process inline citations when enabled", () => {
      const content = `Some content here

#### Sources:
[^1]: [[Document 1]]
[^2]: [[Document 2]]`;

      const result = processInlineCitations(content, true);
      expect(result).toContain("Sources</summary>");
      expect(result).toContain("Document 1");
      expect(result).toContain("Document 2");
    });

    it("should use simple expandable list when disabled", () => {
      const content = `Some content here

#### Sources:
- [[Document 1]]
- [[Document 2]]`;

      const result = processInlineCitations(content, false);
      expect(result).toContain("Sources</summary>");
      expect(result).toContain("Document 1");
      expect(result).toContain("Document 2");
    });

    it("should return unchanged content when no sources section", () => {
      const content = "Just regular content without sources";
      const result = processInlineCitations(content, true);
      expect(result).toBe(content);
    });
  });

  describe("getCitationInstructions", () => {
    it("should return citation instructions when enabled", () => {
      const sourceCatalog = ["- [[Doc 1]] (path1.md)"];
      const result = getCitationInstructions(true, sourceCatalog);

      expect(result).toContain("CITATION RULES:");
      expect(result).toContain("<guidance>");
      expect(result).toContain("Doc 1");
    });

    it("should return empty string when disabled", () => {
      const sourceCatalog = ["- [[Doc 1]] (path1.md)"];
      const result = getCitationInstructions(false, sourceCatalog);

      expect(result).toBe("");
    });
  });

  describe("addFallbackSources", () => {
    it("should add sources when citations enabled and missing", () => {
      const response = "Some content without sources";
      const sources = [{ title: "Document 1" }, { title: "Document 2" }];

      const result = addFallbackSources(response, sources, true);
      expect(result).toContain("#### Sources:");
      expect(result).toContain("[^1]: [[Document 1]]");
      expect(result).toContain("[^2]: [[Document 2]]");
    });

    it("should not add sources when citations disabled", () => {
      const response = "Some content without sources";
      const sources = [{ title: "Document 1" }];

      const result = addFallbackSources(response, sources, false);
      expect(result).toBe(response);
    });

    it("should not add sources when already present", () => {
      const response = "Some content\n#### Sources:\n[^1]: [[Existing]]";
      const sources = [{ title: "Document 1" }];

      const result = addFallbackSources(response, sources, true);
      expect(result).toBe(response);
    });

    it("should handle empty sources array", () => {
      const response = "Some content";
      const sources: any[] = [];

      const result = addFallbackSources(response, sources, true);
      expect(result).toBe(response);
    });

    it("should handle invalid inputs gracefully", () => {
      expect(addFallbackSources("", [{ title: "Doc" }], true)).toBe("");
      expect(addFallbackSources(null as any, [{ title: "Doc" }], true)).toBe("");
      expect(addFallbackSources(undefined as any, [{ title: "Doc" }], true)).toBe("");
    });
  });
});
