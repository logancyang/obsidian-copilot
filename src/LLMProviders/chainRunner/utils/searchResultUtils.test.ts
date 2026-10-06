const mockLogInfo = jest.fn<void, unknown[]>();
const mockLogWarn = jest.fn<void, unknown[]>();
const mockLogMarkdownBlock = jest.fn<void, [string[]]>();

jest.mock("@/logger", () => ({
  logInfo: (...args: unknown[]) => mockLogInfo(...args),
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
  logMarkdownBlock: (lines: string[]) => mockLogMarkdownBlock(lines),
}));

import {
  formatSearchResultsForLLM,
  formatSearchResultStringForLLM,
  formatQualitySummary,
  formatSplitSearchResultsForLLM,
  generateQualitySummary,
  extractSourcesFromSearchResults,
  formatMetadataOnlyDocuments,
  isFilterOnlyResults,
  isTimeDominantResults,
  logSearchResultsDebugTable,
} from "./searchResultUtils";

describe("searchResultUtils", () => {
  describe("formatSearchResultsForLLM()", () => {
    it("returns an empty string for non-array input", () => {
      expect(formatSearchResultsForLLM(null)).toBe("");
      expect(formatSearchResultsForLLM(undefined)).toBe("");
      expect(formatSearchResultsForLLM("string")).toBe("");
      expect(formatSearchResultsForLLM({})).toBe("");
    });

    it("returns the no-documents message for an empty array", () => {
      expect(formatSearchResultsForLLM([])).toBe("No relevant documents found.");
    });

    it("leaves out documents marked includeInContext=false", () => {
      const documents = [
        { title: "Doc1", content: "Content 1", includeInContext: true },
        { title: "Doc2", content: "Content 2", includeInContext: false },
        { title: "Doc3", content: "Content 3" },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("Doc1");
      expect(result).not.toContain("Doc2");
      expect(result).toContain("Doc3");
    });

    it("formats a document with its id, title, path, modified time and content", () => {
      const documents = [
        {
          title: "Test Document",
          path: "path/to/document.md",
          content: "This is the content",
          mtime: new Date("2024-01-15T10:30:00.000Z").getTime(),
        },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain(
        `<document>\n<id>1</id>\n<title>Test Document</title>\n<path>path/to/document.md</path>`
      );
      expect(result).toContain(`<modified>2024-01-15T10:30:00.000Z</modified>`);
      expect(result).toContain(`<content>\nThis is the content\n</content>\n</document>`);
    });

    it("omits the path and modified time when the document has neither", () => {
      const documents = [
        {
          title: "Test Document",
          content: "This is the content",
        },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain(`<document>\n<id>1</id>\n<title>Test Document</title>`);
      expect(result).toContain(`<content>\nThis is the content\n</content>\n</document>`);
    });

    it("omits the path when it equals the title", () => {
      const documents = [
        {
          title: "document.md",
          path: "document.md",
          content: "Content",
        },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).not.toContain("<path>");
    });

    it("omits the modified time when mtime is not a valid date", () => {
      const documents = [
        {
          title: "Test",
          content: "Content",
          mtime: "invalid-date",
        },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).not.toContain("<modified>");
    });

    it("separates multiple documents with a blank line", () => {
      const documents = [
        { title: "Doc1", content: "Content 1" },
        { title: "Doc2", content: "Content 2" },
      ];

      const result = formatSearchResultsForLLM(documents);
      const docs = result.split("\n\n");
      expect(docs).toHaveLength(2);
      expect(docs[0]).toContain("Doc1");
      expect(docs[1]).toContain("Doc2");
    });

    it("still lists documents whose content is empty, null or missing", () => {
      const documents = [
        { title: "Empty Doc", content: "" },
        { title: "Null Doc", content: null },
        { title: "Undefined Doc" },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("Empty Doc");
      expect(result).toContain("Null Doc");
      expect(result).toContain("Undefined Doc");
    });

    it("titles a document without a title Untitled", () => {
      const documents = [{ content: "Content without title" }];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("<title>Untitled</title>");
    });
  });

  describe("formatSearchResultStringForLLM()", () => {
    it("formats the documents in a valid JSON string", () => {
      const documents = [{ title: "Test", content: "Content" }];
      const jsonString = JSON.stringify(documents);

      const result = formatSearchResultStringForLLM(jsonString);
      expect(result).toContain("<title>Test</title>");
      expect(result).toContain("Content");
    });

    it("returns an error message for invalid JSON", () => {
      const result = formatSearchResultStringForLLM("invalid json");
      expect(result).toBe("Error processing search results.");
    });

    it("returns an invalid-format message for JSON that is not an array", () => {
      const result = formatSearchResultStringForLLM(JSON.stringify({ not: "array" }));
      expect(result).toBe("Invalid search results format.");
    });

    it("returns the no-documents message for an empty JSON array", () => {
      const result = formatSearchResultStringForLLM(JSON.stringify([]));
      expect(result).toBe("No relevant documents found.");
    });
  });

  describe("extractSourcesFromSearchResults()", () => {
    it("returns an empty array for non-array input", () => {
      expect(extractSourcesFromSearchResults(null)).toEqual([]);
      expect(extractSourcesFromSearchResults(undefined)).toEqual([]);
      expect(extractSourcesFromSearchResults("string")).toEqual([]);
    });

    it("extracts title, path, score and explanation from each document", () => {
      const documents = [
        {
          title: "Document 1",
          path: "path/to/doc1.md",
          score: 0.95,
          rerank_score: 0.98,
          explanation: { someData: "value" },
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toEqual({
        title: "Document 1",
        path: "path/to/doc1.md",
        score: 0.98,
        explanation: { someData: "value" },
      });
    });

    it("scores a source by rerank_score when it has both scores", () => {
      const documents = [
        {
          title: "Test",
          score: 0.5,
          rerank_score: 0.8,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].score).toBe(0.8);
    });

    it("scores a source by score when it has no rerank_score", () => {
      const documents = [
        {
          title: "Test",
          score: 0.5,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].score).toBe(0.5);
    });

    it("titles a source by its path when it has no title", () => {
      const documents = [
        {
          path: "path/to/document.md",
          score: 0.7,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].title).toBe("path/to/document.md");
      expect(sources[0].path).toBe("path/to/document.md");
    });

    it("gives a source its title as path when it has no path", () => {
      const documents = [
        {
          title: "Document Title",
          score: 0.7,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].title).toBe("Document Title");
      expect(sources[0].path).toBe("Document Title");
    });

    it("titles a source Untitled with an empty path when it has neither title nor path", () => {
      const documents = [
        {
          score: 0.7,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].title).toBe("Untitled");
      expect(sources[0].path).toBe("");
    });

    it("scores a source 0 when it has no score", () => {
      const documents = [
        {
          title: "Test",
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].score).toBe(0);
    });

    it("keeps a given explanation and uses null when there is none", () => {
      const documents = [
        { title: "With Explanation", explanation: { data: "test" } },
        { title: "Without Explanation" },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].explanation).toEqual({ data: "test" });
      expect(sources[1].explanation).toBeNull();
    });

    it("returns one source per document in order", () => {
      const documents = [
        { title: "Doc1", score: 0.9 },
        { title: "Doc2", score: 0.8 },
        { title: "Doc3", score: 0.7 },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources).toHaveLength(3);
      expect(sources.map((s) => s.title)).toEqual(["Doc1", "Doc2", "Doc3"]);
    });

    it("labels a Miyo result from another folder with that folder's name instead of treating it as a vault note — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
      const sources = extractSourcesFromSearchResults([
        { title: "Plan", path: "notes/plan.md", score: 0.9, fromCurrentVault: true },
        {
          title: "Idea",
          path: "Research/ideas/idea.md",
          score: 0.8,
          fromCurrentVault: false,
          miyoSource: "documents",
        },
      ]);

      expect(sources).toEqual([
        { title: "Plan", path: "notes/plan.md", score: 0.9, explanation: null },
        {
          title: "Idea",
          path: "Research/ideas/idea.md",
          score: 0.8,
          explanation: null,
          outsideVaultLabel: "Research",
        },
      ]);
    });

    it("labels a Miyo result from a synced chat folder as Chat — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
      const [source] = extractSourcesFromSearchResults([
        {
          title: "Trip planning",
          path: "ChatGPT/2026-01-02 trip.md",
          score: 0.7,
          fromCurrentVault: false,
          miyoSource: "chats",
        },
      ]);

      expect(source.outsideVaultLabel).toBe("Chat");
    });
  });

  describe("generateQualitySummary()", () => {
    it("counts high (0.7 and up), medium (0.3 and up) and low scores and averages them, preferring rerank_score", () => {
      const summary = generateQualitySummary([
        { score: 0.9 },
        { score: 0.1, rerank_score: 0.7 },
        { score: 0.5 },
        { score: 0.2 },
      ]);

      expect(summary).toMatchObject({ high: 2, medium: 1, low: 1, total: 4 });
      expect(summary.averageScore).toBeCloseTo(0.575, 5);
    });

    it("returns an all-zero summary for no results", () => {
      expect(generateQualitySummary([])).toEqual({
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
        averageScore: 0,
      });
    });
  });

  describe("formatQualitySummary()", () => {
    it("lists only the non-empty relevance buckets", () => {
      expect(
        formatQualitySummary({ high: 2, medium: 0, low: 1, total: 3, averageScore: 0.5 })
      ).toBe("[Relevance: 2 high, 1 low]");
    });

    it("reports no results when every bucket is empty", () => {
      expect(formatQualitySummary({ high: 0, medium: 0, low: 0, total: 0, averageScore: 0 })).toBe(
        "[Relevance: no results]"
      );
    });
  });

  describe("formatSplitSearchResultsForLLM()", () => {
    it("puts filter documents in filterResults with their match type and search documents in searchResults, numbering ids across both", () => {
      const result = formatSplitSearchResultsForLLM(
        [{ title: "Daily", path: "daily.md", content: "Filtered", source: "tag-match" }],
        [{ title: "Found", path: "found.md", content: "Searched" }]
      );

      expect(result).toContain("<filterResults>");
      expect(result).toContain("<id>1</id>\n<title>Daily</title>\n<path>daily.md</path>");
      expect(result).toContain("<matchType>tag-match</matchType>");
      expect(result).toContain("<searchResults>");
      expect(result).toContain("<id>2</id>\n<title>Found</title>\n<path>found.md</path>");
    });

    it("returns the no-documents message when both lists are empty", () => {
      expect(formatSplitSearchResultsForLLM([], [])).toBe("No relevant documents found.");
    });
  });

  describe("formatMetadataOnlyDocuments()", () => {
    it("returns an empty string for an empty array", () => {
      expect(formatMetadataOnlyDocuments([])).toBe("");
    });

    it("returns an empty string for non-array input", () => {
      expect(formatMetadataOnlyDocuments(null)).toBe("");
      expect(formatMetadataOnlyDocuments(undefined)).toBe("");
    });

    it("states the document count", () => {
      const docs = [
        { title: "Doc1", content: "Content 1" },
        { title: "Doc2", content: "Content 2" },
        { title: "Doc3", content: "Content 3" },
      ];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain('count="3"');
    });

    it("tells the model to call readNote for full content", () => {
      const docs = [{ title: "Doc1", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain(
        'note="These results contain titles and metadata only. To read the full content of a note, call the readNote tool with its path."'
      );
    });

    it("lists each document's title, path, modified time and content snippet", () => {
      const docs = [
        {
          title: "My Note",
          path: "folder/my-note.md",
          mtime: new Date("2024-01-15T10:30:00.000Z").getTime(),
          content: "This is the note content",
        },
      ];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain("<title>My Note</title>");
      expect(result).toContain("<path>folder/my-note.md</path>");
      expect(result).toContain("<modified>2024-01-15T10:30:00.000Z</modified>");
      expect(result).toContain("<snippet>This is the note content</snippet>");
    });

    it("cuts the snippet to 300 characters by default", () => {
      const longContent = "a".repeat(400);
      const docs = [{ title: "Doc", content: longContent }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain(`<snippet>${"a".repeat(300)}</snippet>`);
      expect(result).not.toContain("a".repeat(301));
    });

    it("omits the path when the document has none", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<path>");
    });

    it("omits the modified time when mtime is missing", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<modified>");
    });

    it("omits the snippet when content is empty", () => {
      const docs = [{ title: "Doc", content: "" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<snippet>");
    });

    it("titles a document without a title Untitled", () => {
      const docs = [{ content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain("<title>Untitled</title>");
    });

    it("wraps the output in an additionalMatches element", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toMatch(/^<additionalMatches /);
      expect(result).toMatch(/<\/additionalMatches>$/);
    });
  });

  describe("isFilterOnlyResults()", () => {
    it("returns false for an empty array", () => {
      expect(isFilterOnlyResults([])).toBe(false);
    });

    it("returns false for non-array input", () => {
      expect(isFilterOnlyResults(null as unknown as Array<{ source?: string }>)).toBe(false);
      expect(isFilterOnlyResults(undefined as unknown as Array<{ source?: string }>)).toBe(false);
    });

    it("returns true when every document comes from a filter source", () => {
      const docs = [{ source: "time-filtered" }, { source: "tag-match" }];
      expect(isFilterOnlyResults(docs)).toBe(true);
    });

    it("returns false for title-match documents because they carry full content", () => {
      const docs = [{ source: "title-match" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("returns false when a title-match document is mixed with filter documents", () => {
      const docs = [{ source: "tag-match" }, { source: "title-match" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("returns false when any document has a non-filter source", () => {
      const docs = [{ source: "time-filtered" }, { source: "semantic" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("returns false when any document has no source", () => {
      const docs = [{ source: "tag-match" }, {}];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });
  });

  describe("isTimeDominantResults()", () => {
    it("returns false for an empty array", () => {
      expect(isTimeDominantResults([])).toBe(false);
    });

    it("returns false for non-array input", () => {
      expect(isTimeDominantResults(null as unknown as Array<{ source?: string }>)).toBe(false);
      expect(isTimeDominantResults(undefined as unknown as Array<{ source?: string }>)).toBe(false);
    });

    it("returns true when at least one document is time-filtered", () => {
      const docs = [{ source: "tag-match" }, { source: "time-filtered" }];
      expect(isTimeDominantResults(docs)).toBe(true);
    });

    it("returns false when no document is time-filtered", () => {
      const docs = [{ source: "tag-match" }, { source: "title-match" }];
      expect(isTimeDominantResults(docs)).toBe(false);
    });

    it("returns false when the document has no source", () => {
      expect(isTimeDominantResults([{}])).toBe(false);
    });
  });

  describe("logSearchResultsDebugTable()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("writes every result to the rolling log file as a Markdown table row", () => {
      logSearchResultsDebugTable([
        { path: "notes/alpha.md", score: 0.5, includeInContext: true },
        { path: "notes/beta.md", score: 0.25, includeInContext: false },
      ]);

      expect(mockLogInfo).toHaveBeenCalledWith(
        "Search Results (debug table): 2 rows; in-context 1/2"
      );
      const lines = mockLogMarkdownBlock.mock.calls[0][0];
      expect(lines).toContain("| PATH | IN | MTIME | SCORE | EXPLANATION |");
      expect(lines.some((line) => line.includes("notes/alpha.md") && line.includes("0.5000"))).toBe(
        true
      );
      expect(lines.some((line) => line.includes("notes/beta.md") && line.includes("0.2500"))).toBe(
        true
      );
    });

    it("reports no results without writing a table", () => {
      logSearchResultsDebugTable([]);

      expect(mockLogInfo).toHaveBeenCalledWith("Search Results: (none)");
      expect(mockLogMarkdownBlock).not.toHaveBeenCalled();
    });
  });
});
