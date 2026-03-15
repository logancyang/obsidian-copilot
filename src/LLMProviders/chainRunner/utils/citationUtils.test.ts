import {
  addFallbackSources,
  deduplicateAdjacentCitations,
  extractSourcesSection,
  formatSourceCatalog,
  getCitationFormatReminder,
  getLocalSearchGuidance,
  getQACitationInstructions,
  hasExistingCitations,
  hasInlineCitations,
  normalizeCitations,
  processInlineCitations,
  sanitizeContentForCitations,
  updateCitationsForConsolidation,
  type SourceCatalogEntry,
} from "./citationUtils";

/** Helper: wraps a citation like [1] in the placeholder span for test assertions. */
const ref = (n: number | string) => `<span class="copilot-citation-ref">[${n}]</span>`;

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

  describe("hasInlineCitations", () => {
    it("should detect inline citations in body text", () => {
      const responseWithInlineCitations = "This is a claim [^1] and another claim [^2].";
      expect(hasInlineCitations(responseWithInlineCitations)).toBe(true);

      const multipleCitations = "First claim [^1]. Second claim [^2]. Third claim [^3].";
      expect(hasInlineCitations(multipleCitations)).toBe(true);
    });

    it("should detect inline citations with footnote definitions", () => {
      const fullResponse = `This is a claim [^1] and another [^2].

#### Sources
[^1]: [[Doc One]]
[^2]: [[Doc Two]]`;
      expect(hasInlineCitations(fullResponse)).toBe(true);
    });

    it("should return false for responses without inline citations", () => {
      const responseWithoutCitations = "Just regular content here";
      expect(hasInlineCitations(responseWithoutCitations)).toBe(false);

      const responseWithOnlyFootnoteDefinitions = `Content here

[^1]: [[Document]]
[^2]: [[Another]]`;
      // This should still detect [^1] and [^2] in the footnote definitions
      expect(hasInlineCitations(responseWithOnlyFootnoteDefinitions)).toBe(true);
    });

    it("should handle edge cases", () => {
      expect(hasInlineCitations("")).toBe(false);
      expect(hasInlineCitations(null as any)).toBe(false);
      expect(hasInlineCitations(undefined as any)).toBe(false);
    });

    it("should NOT confuse markdown links with citations", () => {
      const responseWithLinks = "Check [this link](url) and [[wikilink]] here";
      expect(hasInlineCitations(responseWithLinks)).toBe(false);
    });
  });

  describe("getLocalSearchGuidance", () => {
    it("should format local search guidance with citation rules, image inclusion, and source catalog", () => {
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

  describe("extractSourcesSection", () => {
    it("should extract #### Sources heading", () => {
      const content = `Main content here

#### Sources:
[^1]: [[Doc A]]
[^2]: [[Doc B]]`;
      const result = extractSourcesSection(content);
      expect(result).not.toBeNull();
      expect(result!.mainContent).toContain("Main content here");
      expect(result!.sourcesBlock).toContain("[^1]: [[Doc A]]");
    });

    it("should extract bare Sources label", () => {
      const content = `Main content

Sources
[^1]: [[Doc]]`;
      const result = extractSourcesSection(content);
      expect(result).not.toBeNull();
      expect(result!.sourcesBlock).toContain("[^1]: [[Doc]]");
    });

    it("should extract --- separator with footnote definitions", () => {
      const content = `Some analysis with citations [^201] and [^202].

---

[^201]: [[How to Make Wealth]]
[^202]: [[Superlinear Returns]]`;
      const result = extractSourcesSection(content);
      expect(result).not.toBeNull();
      expect(result!.mainContent).toContain("Some analysis with citations");
      expect(result!.sourcesBlock).toContain("[^201]: [[How to Make Wealth]]");
      expect(result!.sourcesBlock).toContain("[^202]: [[Superlinear Returns]]");
    });

    it("should not treat --- as sources separator when content after has no footnotes", () => {
      const content = `Paragraph one

---

Paragraph two continues here`;
      const result = extractSourcesSection(content);
      expect(result).toBeNull();
    });

    it("should extract trailing bare footnote definitions with no separator", () => {
      const content = `Content with citations [^1] and [^2].

[^1]: [[Note A]]
[^2]: [[Note B]]`;
      const result = extractSourcesSection(content);
      expect(result).not.toBeNull();
      expect(result!.mainContent).toContain("Content with citations");
      expect(result!.sourcesBlock).toContain("[^1]: [[Note A]]");
      expect(result!.sourcesBlock).toContain("[^2]: [[Note B]]");
    });

    it("should return null when no sources pattern found", () => {
      expect(extractSourcesSection("Just plain content")).toBeNull();
    });

    it("should prefer Sources heading over --- when both present", () => {
      const content = `Content

---

More content

#### Sources
[^1]: [[Doc]]`;
      const result = extractSourcesSection(content);
      expect(result).not.toBeNull();
      expect(result!.sourcesBlock).toContain("[^1]: [[Doc]]");
      // Strategy 1 matches first, so mainContent includes everything before "#### Sources"
      expect(result!.mainContent).toContain("More content");
    });
  });

  describe("getCitationFormatReminder", () => {
    it("should return reminder when citations enabled", () => {
      const result = getCitationFormatReminder(true);
      expect(result).not.toBeNull();
      expect(result).toContain("#### Sources");
      expect(result).toContain("[^n]");
    });

    it("should return null when citations disabled", () => {
      expect(getCitationFormatReminder(false)).toBeNull();
    });
  });

  describe("processInlineCitations", () => {
    it("should process inline citations with footnote format", () => {
      const content = `Some content here

#### Sources:
[^1]: [[Document 1]]
[^2]: [[Document 2]]`;

      const result = processInlineCitations(content);
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__text">[[Document 1]]');
      expect(result).toContain('copilot-sources__text">[[Document 2]]');
    });

    it("should handle simple list format", () => {
      const content = `Some content here

#### Sources:
- [[Document 1]]
- [[Document 2]]`;

      const result = processInlineCitations(content);
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__text">[[Document 1]]');
      expect(result).toContain('copilot-sources__text">[[Document 2]]');
    });

    it("should return unchanged content when no sources section", () => {
      const content = "Just regular content without sources";
      const result = processInlineCitations(content);
      expect(result).toBe(content);
    });

    it("should process citations with --- separator (common in agent mode)", () => {
      const content = `Here are the findings [^1] and [^2].

---

[^1]: [[How to Make Wealth]]
[^2]: [[Superlinear Returns]]`;

      const result = processInlineCitations(content);
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__text">[[How to Make Wealth]]');
      expect(result).toContain('copilot-sources__text">[[Superlinear Returns]]');
    });

    it("should process citations with bare trailing footnotes (no separator)", () => {
      const content = `Analysis shows key insights [^1] about this topic [^2].

[^1]: [[Note A]]
[^2]: [[Note B]]`;

      const result = processInlineCitations(content);
      expect(result).toContain("copilot-sources__summary");
      expect(result).toContain('copilot-sources__text">[[Note A]]');
      expect(result).toContain('copilot-sources__text">[[Note B]]');
    });

    it("should handle non-sequential footnote numbers with --- separator", () => {
      const content = `Point A [^201] and point B [^202].

---

[^201]: [[Doc One]]
[^202]: [[Doc Two]]`;

      const result = processInlineCitations(content);
      expect(result).toContain("copilot-sources__summary");
      // Non-sequential [^201] and [^202] should be renumbered to [1] and [2]
      expect(result).toContain('copilot-sources__index">[1]');
      expect(result).toContain('copilot-sources__index">[2]');
      expect(result).toContain(`Point A ${ref(1)}`);
      expect(result).toContain(`point B ${ref(2)}`);
    });
  });

  describe("addFallbackSources", () => {
    it("should add sources when missing", () => {
      const response = "Some content without sources";
      const sources = [{ title: "Document 1" }, { title: "Document 2" }];

      const result = addFallbackSources(response, sources);
      expect(result).toContain("#### Sources:");
      expect(result).toContain("[^1]: [[Document 1]]");
      expect(result).toContain("[^2]: [[Document 2]]");
    });

    it("should not add sources when already present", () => {
      const response = "Some content\n#### Sources:\n[^1]: [[Existing]]";
      const sources = [{ title: "Document 1" }];

      const result = addFallbackSources(response, sources);
      expect(result).toBe(response);
    });

    it("should handle empty sources array", () => {
      const response = "Some content";
      const sources: any[] = [];

      const result = addFallbackSources(response, sources);
      expect(result).toBe(response);
    });

    it("should handle invalid inputs gracefully", () => {
      expect(addFallbackSources("", [{ title: "Doc" }])).toBe("");
      expect(addFallbackSources(null as any, [{ title: "Doc" }])).toBe("");
      expect(addFallbackSources(undefined as any, [{ title: "Doc" }])).toBe("");
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

      const result = processInlineCitations(content);

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
      expect(result).toContain(`Dolce Arts Studio ${ref(1)}`); // [^9] -> [1]
      expect(result).toContain(`7 pm ${ref(2)}`); // [^1] -> [2]
      expect(result).toContain(`your routine ${ref(3)}`); // [^2] -> [3]
      expect(result).toContain(`April 8, 2024: You skipped your piano lesson this week ${ref(4)}`); // [^18] -> [4]
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

      const result = processInlineCitations(content);

      // Should consolidate the 3 "How to Make Wealth" entries into 1
      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[How to Make Wealth]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[Superlinear Returns]]</span>'
      );
      expect(result).not.toContain('copilot-sources__index">[3]');
      expect(result).not.toContain('copilot-sources__index">[4]');

      // Verify all citations are properly renumbered
      expect(result).toContain(`inheritance ${ref(1)} He emphasizes`);
      expect(result).toContain(`few years ${ref(1)} Instead of working`);
      expect(result).toContain(`not linear ${ref(2)} In business`);
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

      const result = processInlineCitations(content);

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
      expect(result).toContain(`references ${ref(1)} and also ${ref(2)}`); // [^14]->[1], [^17]->[2]
      expect(result).toContain(`uses ${ref(3)} again`); // [^3]->[3]
      expect(result).toContain(`cites ${ref(1)}`); // [^14]->[1], [^22]->[1] (consolidated + deduplicated)
      expect(result).not.toContain(`cites ${ref(1)} and ${ref(1)}`); // adjacent dupes should be collapsed
      expect(result).toContain(`mentions ${ref(3)} once more`); // [^3]->[3]
    });

    it("should handle consecutive citations without spaces (CRITICAL BUG)", () => {
      // This test replicates the exact user bug with [^7][^8]
      const content = `Paul Graham's advice on wealth:

- Mindset & long game: rewards in these domains are often superlinear — small advantages compound into huge returns — so follow curiosity, do great work, take multiple shots while you're young, and seek situations where effort compounds (learning, network effects, thresholds). [^7][^8]

#### Sources:
[^7]: [[Superlinear Returns]]
[^8]: [[How to Do Great Work]]`;

      const result = processInlineCitations(content);

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
      expect(result).toContain(`thresholds). ${ref(1)}${ref(2)}`); // [^7][^8] -> [1][2]
      expect(result).not.toContain("[^8]"); // Should not contain any unconverted citations
      expect(result).not.toContain("[^7]"); // Should not contain any unconverted citations
    });

    it("should deduplicate adjacent citations after consolidation", () => {
      // Two chunks from the same note cited adjacently: [^1][^2] both -> [[Same Note]]
      const content = `Key finding here [^1][^2] and another point [^3].

#### Sources:
[^1]: [[Same Note]]
[^2]: [[Same Note]]
[^3]: [[Other Note]]`;

      const result = processInlineCitations(content);

      // After consolidation, [^1] and [^2] both map to source 1
      // Adjacent [1][1] should be collapsed to [1]
      expect(result).toContain(`finding here ${ref(1)} and another`);
      expect(result).not.toContain(`${ref(1)}${ref(1)}`);
      expect(result).toContain(
        '<span class="copilot-sources__index">[1]</span><span class="copilot-sources__text">[[Same Note]]</span>'
      );
      expect(result).toContain(
        '<span class="copilot-sources__index">[2]</span><span class="copilot-sources__text">[[Other Note]]</span>'
      );
    });

    it("should deduplicate citations separated by 'and' after consolidation", () => {
      // Use separate brackets since buildCitationMap scans [^N] individually
      const content = `Claim here [^1] and [^2] and more [^3].

#### Sources:
[^1]: [[Note A]]
[^2]: [[Note A]]
[^3]: [[Note B]]`;

      const result = processInlineCitations(content);

      // [^1] and [^2] both map to [[Note A]] -> consolidated to source 1
      // "[1] and [1]" should collapse to "[1]"
      expect(result).toContain(`Claim here ${ref(1)} and more`);
      expect(result).not.toContain(`${ref(1)} and ${ref(1)}`);
    });
  });

  describe("updateCitationsForConsolidation", () => {
    it("should deduplicate numbers within a bracket group", () => {
      const map = new Map([
        [1, 1],
        [2, 1],
        [3, 2],
      ]);
      expect(updateCitationsForConsolidation("[1, 2] text [3]", map)).toBe("[1] text [2]");
    });

    it("should preserve order of first occurrence", () => {
      const map = new Map([
        [1, 1],
        [2, 1],
        [3, 1],
      ]);
      expect(updateCitationsForConsolidation("[1, 2, 3]", map)).toBe("[1]");
    });
  });

  describe("deduplicateAdjacentCitations", () => {
    it("should collapse identical adjacent brackets", () => {
      expect(deduplicateAdjacentCitations("[1][1]")).toBe("[1]");
    });

    it("should collapse triple identical adjacent brackets", () => {
      expect(deduplicateAdjacentCitations("[1][1][1]")).toBe("[1]");
    });

    it("should not collapse different adjacent brackets", () => {
      expect(deduplicateAdjacentCitations("[1][2]")).toBe("[1][2]");
    });

    it("should collapse when second is a subset of first", () => {
      expect(deduplicateAdjacentCitations("[1, 2][1]")).toBe("[1, 2]");
    });

    it("should not collapse when second has new numbers", () => {
      expect(deduplicateAdjacentCitations("[1][1, 2]")).toBe("[1][1, 2]");
    });

    it("should handle mixed cases in sequence", () => {
      expect(deduplicateAdjacentCitations("[1][1][2]")).toBe("[1][2]");
    });

    it("should handle spaces between brackets", () => {
      expect(deduplicateAdjacentCitations("[1] [1]")).toBe("[1]");
    });

    it("should preserve surrounding text", () => {
      expect(deduplicateAdjacentCitations("claim [1][1] and more [2]")).toBe(
        "claim [1] and more [2]"
      );
    });

    it("should collapse duplicates separated by 'and'", () => {
      expect(deduplicateAdjacentCitations("cites [1] and [1]")).toBe("cites [1]");
    });

    it("should not collapse different citations separated by 'and'", () => {
      expect(deduplicateAdjacentCitations("cites [1] and [2]")).toBe("cites [1] and [2]");
    });

    it("should collapse duplicates separated by comma", () => {
      expect(deduplicateAdjacentCitations("cites [1], [1]")).toBe("cites [1]");
    });
  });
});
