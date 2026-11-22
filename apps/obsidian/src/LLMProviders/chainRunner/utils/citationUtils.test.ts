import {
  addFallbackSources,
  formatSourceCatalog,
  getCitationFormatReminder,
  getLocalSearchGuidance,
  hasExistingCitations,
  sanitizeContentForCitations,
  type SourceCatalogEntry,
} from "./citationUtils";

describe("citationUtils", () => {
  describe("sanitizeContentForCitations()", () => {
    it("removes inline footnote references and keeps the surrounding text", () => {
      const input = "This is text with [^1] and [^2] footnotes.";
      const result = sanitizeContentForCitations(input);
      expect(result).not.toContain("[^1]");
      expect(result).not.toContain("[^2]");
      expect(result).toContain("This is text with");
      expect(result).toContain("footnotes.");
    });

    it("removes numeric citations such as [1] and [2, 3] but keeps markdown links", () => {
      const input = "Study shows [1] and see [this link](https://example.com) and [2, 3] results.";
      const result = sanitizeContentForCitations(input);
      expect(result).not.toContain("[1]");
      expect(result).not.toContain("[2, 3]");
      expect(result).toContain("[this link](https://example.com)");
    });

    it("removes footnote definition lines and keeps the other lines", () => {
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

    it("returns an empty string for empty, null or undefined content", () => {
      expect(sanitizeContentForCitations("")).toBe("");
      expect(sanitizeContentForCitations(null)).toBe("");
      expect(sanitizeContentForCitations(undefined)).toBe("");
    });
  });

  describe("formatSourceCatalog()", () => {
    it("formats each source as a wikilink list item followed by its path", () => {
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

    it("falls back to the path for a missing title and to the title for a missing path", () => {
      const sources: SourceCatalogEntry[] = [
        { title: "", path: "path/to/doc.md" },
        { title: "Document", path: "" },
      ];
      const result = formatSourceCatalog(sources);

      expect(result[0]).toContain("path/to/doc.md");
      expect(result[1]).toContain("Document");
      expect(result).toHaveLength(2);
    });

    it("returns an empty list for no sources", () => {
      expect(formatSourceCatalog([])).toEqual([]);
    });
  });

  describe("hasExistingCitations()", () => {
    it("detects a Sources heading or label", () => {
      const responseWithSources = "Some content\n#### Sources:\n[^1]: [[Doc]]";
      expect(hasExistingCitations(responseWithSources)).toBe(true);

      const responseWithSourcesColon = "Some content\nSources:\n[^1]: [[Doc]]";
      expect(hasExistingCitations(responseWithSourcesColon)).toBe(true);
    });

    it("detects a level-2 Sources heading, a dashed label and the HTML sources summary", () => {
      const heading = "Content\n## Sources\n[^1]: [[Doc]]";
      expect(hasExistingCitations(heading)).toBe(true);

      const dashHeading = "Content\nSources -\n[^1]: [[Doc]]";
      expect(hasExistingCitations(dashHeading)).toBe(true);

      const summary =
        '<details><summary class="copilot-sources__summary">Sources</summary>List</details>';
      expect(hasExistingCitations(summary)).toBe(true);
    });

    it("detects a footnote definition that links a note", () => {
      const responseWithFootnotes = "Some content\n[^1]: [[Document Name]]";
      expect(hasExistingCitations(responseWithFootnotes)).toBe(true);
    });

    it("detects bare footnote definitions so sources are not appended twice", () => {
      const responseWithBareFootnotes =
        "Content here\n[^1]: [[How to Make Wealth]]\n[^2]: [[Superlinear Returns]]";
      expect(hasExistingCitations(responseWithBareFootnotes)).toBe(true);

      const responseWithFootnotesNoWikilinks =
        "Content here\n[^1]: How to Make Wealth\n[^2]: Superlinear Returns";
      expect(hasExistingCitations(responseWithFootnotesNoWikilinks)).toBe(true);
    });

    it("detects indented footnote definitions", () => {
      const responseWithIndentedFootnotes =
        "Content here\n   [^1]: [[Document]]\n  [^2]: [[Another]]";
      expect(hasExistingCitations(responseWithIndentedFootnotes)).toBe(true);
    });

    it("does not treat inline citations without definitions as existing citations", () => {
      const responseWithInlineCitations = "This is a claim [^1] and another claim [^2].";
      expect(hasExistingCitations(responseWithInlineCitations)).toBe(false);
    });

    it("returns false for a response without citations", () => {
      const responseWithoutCitations = "Just regular content here";
      expect(hasExistingCitations(responseWithoutCitations)).toBe(false);
    });

    it("returns false for empty, null or undefined content", () => {
      expect(hasExistingCitations("")).toBe(false);
      expect(hasExistingCitations(null)).toBe(false);
      expect(hasExistingCitations(undefined)).toBe(false);
    });

    it("detects a response that repeats its footnote definitions under a Sources heading", () => {
      const userExample = `Content here

[^1]: [[How to Make Wealth]]
[^2]: [[Superlinear Returns]]

#### Sources
[^1]: [[How to Make Wealth]]
[^2]: [[Superlinear Returns]]`;
      expect(hasExistingCitations(userExample)).toBe(true);
    });
  });

  describe("getLocalSearchGuidance()", () => {
    it("includes the citation rules, image inclusion rules and the given source catalog inside a guidance block", () => {
      const sourceCatalog = ["- [[Doc 1]] (path1.md)", "- [[Doc 2]] (path2.md)"];
      const result = getLocalSearchGuidance(sourceCatalog);

      expect(result).toContain("<guidance>");
      expect(result).toContain("</guidance>");
      expect(result).toContain("CITATION RULES:");
      expect(result).toContain("START with [^1]");
      expect(result).toContain("IMAGE INCLUSION:");
      expect(result).toContain("Source Catalog (for reference only):");
      expect(result).toContain("- [[Doc 1]] (path1.md)");
      expect(result).toContain("- [[Doc 2]] (path2.md)");
    });
  });

  describe("getCitationFormatReminder()", () => {
    it("returns a Sources format reminder when citations are enabled", () => {
      const result = getCitationFormatReminder(true);
      expect(result).not.toBeNull();
      expect(result).toContain("#### Sources");
      expect(result).toContain("[^n]");
    });

    it("returns null when citations are disabled", () => {
      expect(getCitationFormatReminder(false)).toBeNull();
    });
  });

  describe("addFallbackSources()", () => {
    it("appends a numbered Sources section when the response has none", () => {
      const response = "Some content without sources";
      const sources = [{ title: "Document 1" }, { title: "Document 2" }];

      const result = addFallbackSources(response, sources);
      expect(result).toContain("#### Sources:");
      expect(result).toContain("[^1]: [[Document 1]]");
      expect(result).toContain("[^2]: [[Document 2]]");
    });

    it("returns the response unchanged when it already has a Sources section", () => {
      const response = "Some content\n#### Sources:\n[^1]: [[Existing]]";
      const sources = [{ title: "Document 1" }];

      const result = addFallbackSources(response, sources);
      expect(result).toBe(response);
    });

    it("returns the response unchanged when there are no sources", () => {
      const response = "Some content";
      const sources: { title?: string; path?: string }[] = [];

      const result = addFallbackSources(response, sources);
      expect(result).toBe(response);
    });

    it("returns an empty string for empty, null or undefined responses", () => {
      expect(addFallbackSources("", [{ title: "Doc" }])).toBe("");
      expect(addFallbackSources(null, [{ title: "Doc" }])).toBe("");
      expect(addFallbackSources(undefined, [{ title: "Doc" }])).toBe("");
    });
  });
});
