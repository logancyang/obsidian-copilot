import {
  addFallbackSources,
  formatSourceCatalog,
  getCitationInstructions,
  getQACitationInstructions,
  getVaultCitationGuidance,
  hasExistingCitations,
  normalizeCitations,
  processInlineCitations,
  sanitizeContentForCitations,
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

    it("should detect alternate headings and HTML summaries", () => {
      const heading = "Content\n## Sources\n[^1]: [[Doc]]";
      expect(hasExistingCitations(heading)).toBe(true);

      const dashHeading = "Content\nSources -\n[^1]: [[Doc]]";
      expect(hasExistingCitations(dashHeading)).toBe(true);

      const summary =
        '<details><summary class="copilot-sources__summary">Sources</summary>List</details>';
      expect(hasExistingCitations(summary)).toBe(true);
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
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__text">[[Document 1]]');
      expect(result).toContain('copilot-sources__text">[[Document 2]]');
    });

    it("should use simple expandable list when disabled", () => {
      const content = `Some content here

#### Sources:
- [[Document 1]]
- [[Document 2]]`;

      const result = processInlineCitations(content, false);
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__text">[[Document 1]]');
      expect(result).toContain('copilot-sources__text">[[Document 2]]');
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

  describe("normalizeCitations", () => {
    it("should remove periods after citations to prevent markdown list interpretation", () => {
      const content = "This is a claim [1]. Another claim [2]. Final text.";
      const map = new Map([
        [1, 1],
        [2, 2],
      ]);

      const result = normalizeCitations(content, map);
      expect(result).toBe("This is a claim [1] Another claim [2] Final text.");
      expect(result).not.toContain("[1].");
      expect(result).not.toContain("[2].");
    });

    it("should handle footnote references with periods", () => {
      const content = "Text with [^1]. More text [^2].";
      const map = new Map([
        [1, 1],
        [2, 2],
      ]);

      const result = normalizeCitations(content, map);
      expect(result).toBe("Text with [1] More text [2]");
    });

    it("should handle multiple citations in brackets", () => {
      const content = "Text with single [^1] and multiple [^2, ^4] citations.";
      const map = new Map([
        [1, 1],
        [2, 2],
        [4, 3],
      ]);

      const result = normalizeCitations(content, map);
      expect(result).toBe("Text with single [1] and multiple [2, 3] citations.");
    });

    it("should sort multiple citations in ascending order", () => {
      const content = "Text with unordered [^6, ^1, ^4] citations.";
      const map = new Map([
        [1, 1],
        [4, 2],
        [6, 3],
      ]);

      const result = normalizeCitations(content, map);
      expect(result).toBe("Text with unordered [1, 2, 3] citations.");
    });
  });

  describe("processInlineCitations - citation mapping bugs", () => {
    it("should handle non-sequential citations correctly (CRITICAL BUG)", () => {
      // This test demonstrates the CRITICAL bug where citations don't map to correct sources
      const content = `Here are some notes related to your piano practice:

*   **Piano Lessons:** You've been taking piano lessons at Dolce Arts Studio [^9]. You decided on 45-minute sessions every Wednesday at 7 pm [^1].
*   **Practice Routines:** You have scheduled piano practice as part of your routine [^2].
*   **Specific Dates:**
    *   March 13, 2024: Piano trial lesson at Dolce Arts Studio [^9].
    *   March 18, 2024: You decided on lesson schedule [^1].
    *   April 8, 2024: You skipped your piano lesson this week [^18].

#### Sources:
[^1]: [[2024-03-18]]
[^2]: [[2024-03-26]]
[^9]: [[2024-03-13]]
[^18]: [[2024-04-08]]`;

      const result = processInlineCitations(content, true);

      // CRITICAL: Each citation must map to the correct source
      // After processing, we expect:
      // [^9] (first mention) -> [1] -> should map to [[2024-03-13]]
      // [^1] (second mention) -> [2] -> should map to [[2024-03-18]]
      // [^2] (third mention) -> [3] -> should map to [[2024-03-26]]
      // [^18] (fourth mention) -> [4] -> should map to [[2024-04-08]]

      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[2024-03-13]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[2024-03-18]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[3]</span><span class="copilot-sources__text">[[2024-03-26]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[4]</span><span class="copilot-sources__text">[[2024-04-08]]</span>'
      );

      // Verify the citations in text are renumbered correctly
      expect(result).toContain("Dolce Arts Studio [1]"); // [^9] -> [1]
      expect(result).toContain("7 pm [2]"); // [^1] -> [2]
      expect(result).toContain("your routine [3]"); // [^2] -> [3]
      expect(result).toContain("April 8, 2024: You skipped your piano lesson this week [4]"); // [^18] -> [4]
    });

    it("should consolidate duplicate sources from user's real example", () => {
      // This replicates the exact user scenario with multiple citations to "How to Make Wealth"
      const content = `Based on the search results from your vault, here's what Paul Graham has said about getting rich:

*   **Creating Wealth:** Paul Graham believes in making money by creating wealth and getting paid for it, which he considers more legitimate and straightforward than other methods like chance, speculation, or inheritance [^1]. He emphasizes that you simply have to do something people want [^1].
*   **Startups as Wealth Compression:** Graham suggests that a startup is a way to compress your whole working life into a few years [^2]. Instead of working at a low intensity for forty years, you work as hard as you possibly can for four, which pays well in technology where there's a premium for working fast [^2].
*   **Millions vs. Billions:** He advises against using famous rich people like Bill Gates as examples because they tend to be outliers, and their success often involves a large random factor and luck [^3].
*   **Superlinear Returns:** Graham highlights the concept of superlinear returns, where performance returns are not linear [^4]. In business, if your product is only half as good as your competitor's, you don't get half as many customers; you get none [^4].

#### Sources:
[^1]: [[How to Make Wealth]]
[^2]: [[How to Make Wealth]]
[^3]: [[How to Make Wealth]]
[^4]: [[Superlinear Returns]]`;

      const result = processInlineCitations(content, true);

      // Should consolidate the 3 "How to Make Wealth" entries into 1
      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[How to Make Wealth]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[Superlinear Returns]]</span>'
      );
      expect(result).not.toContain('copilot-sources__index">[3]');
      expect(result).not.toContain('copilot-sources__index">[4]');

      // Verify periods after citations are removed
      expect(result).not.toContain("[1].");
      expect(result).not.toContain("[2].");

      // Verify all citations are properly renumbered
      expect(result).toContain("inheritance [1] He emphasizes");
      expect(result).toContain("few years [1] Instead of working");
      expect(result).toContain("not linear [2] In business");
    });

    it("should handle complex non-sequential citations with duplicates", () => {
      // Test with both non-sequential AND duplicate citations
      const content = `Complex example:

*   First point references [^14] and also [^17].
*   Second point uses [^3] again.
*   Third point cites [^14] and [^22].
*   Final point mentions [^3] once more.

#### Sources:
[^3]: [[Document A]]
[^14]: [[Document B]]
[^17]: [[Document C]]
[^22]: [[Document B]]`;

      const result = processInlineCitations(content, true);

      // Expected renumbering based on first mention:
      // [^14] (first mention) -> [1] -> [[Document B]]
      // [^17] (second mention) -> [2] -> [[Document C]]
      // [^3] (third mention) -> [3] -> [[Document A]]
      // [^22] (fourth mention) -> [4] -> [[Document B]] (should consolidate with [^14])

      // After consolidation, should only have 3 unique sources:
      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[Document B]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[Document C]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[3]</span><span class="copilot-sources__text">[[Document A]]</span>'
      );
      expect(result).not.toContain('copilot-sources__index">[4]');

      // Verify citations in text point to correct consolidated sources
      expect(result).toContain("references [1] and also [2]"); // [^14]->[1], [^17]->[2]
      expect(result).toContain("uses [3] again"); // [^3]->[3]
      expect(result).toContain("cites [1] and [1]"); // [^14]->[1], [^22]->[1] (consolidated)
      expect(result).toContain("mentions [3] once more"); // [^3]->[3]
    });

    it("should handle consecutive citations without spaces (CRITICAL BUG)", () => {
      // This test replicates the exact user bug with [^7][^8]
      const content = `Paul Graham's advice on wealth:

- Mindset & long game: rewards in these domains are often superlinear — small advantages compound into huge returns — so follow curiosity, do great work, take multiple shots while you're young, and seek situations where effort compounds (learning, network effects, thresholds). [^7][^8]

#### Sources:
[^7]: [[Superlinear Returns]]
[^8]: [[How to Do Great Work]]`;

      const result = processInlineCitations(content, true);

      // CRITICAL: Both consecutive citations must be processed correctly
      // [^7] (first mention) -> [1] -> [[Superlinear Returns]]
      // [^8] (second mention) -> [2] -> [[How to Do Great Work]]

      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[Superlinear Returns]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[How to Do Great Work]]</span>'
      );

      // CRITICAL: Both citations in text must be converted (not partial like [4][^8])
      expect(result).toContain("thresholds). [1][2]"); // [^7][^8] -> [1][2]
      expect(result).not.toContain("[^8]"); // Should not contain any unconverted citations
      expect(result).not.toContain("[^7]"); // Should not contain any unconverted citations
    });
  });
});
