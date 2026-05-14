import {
  formatSearchResultsForLLM,
  formatSearchResultStringForLLM,
  extractSourcesFromSearchResults,
  formatMetadataOnlyDocuments,
  isFilterOnlyResults,
  isTimeDominantResults,
} from "./searchResultUtils";

describe("searchResultUtils", () => {
  describe("formatSearchResultsForLLM", () => {
    it("should return empty string for non-array input", () => {
      expect(formatSearchResultsForLLM(null)).toBe("");
      expect(formatSearchResultsForLLM(undefined)).toBe("");
      expect(formatSearchResultsForLLM("string")).toBe("");
      expect(formatSearchResultsForLLM({})).toBe("");
    });

    it("should return 'No relevant documents found.' for empty array", () => {
      expect(formatSearchResultsForLLM([])).toBe("No relevant documents found.");
    });

    it("should filter out documents with includeInContext=false", () => {
      const documents = [
        { title: "Doc1", content: "Content 1", includeInContext: true },
        { title: "Doc2", content: "Content 2", includeInContext: false },
        { title: "Doc3", content: "Content 3" }, // undefined defaults to true
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("Doc1");
      expect(result).not.toContain("Doc2");
      expect(result).toContain("Doc3");
    });

    it("should format single document with all metadata", () => {
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

    it("should handle missing optional fields gracefully", () => {
      const documents = [
        {
          title: "Test Document",
          content: "This is the content",
          // no path, no mtime
        },
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain(`<document>\n<id>1</id>\n<title>Test Document</title>`);
      expect(result).toContain(`<content>\nThis is the content\n</content>\n</document>`);
    });

    it("should not include path if it equals title", () => {
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

    it("should handle invalid mtime gracefully", () => {
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

    it("should format multiple documents separated by double newlines", () => {
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

    it("should handle documents with empty content", () => {
      const documents = [
        { title: "Empty Doc", content: "" },
        { title: "Null Doc", content: null },
        { title: "Undefined Doc" }, // content undefined
      ];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("Empty Doc");
      expect(result).toContain("Null Doc");
      expect(result).toContain("Undefined Doc");
    });

    it("should use 'Untitled' for missing title", () => {
      const documents = [{ content: "Content without title" }];

      const result = formatSearchResultsForLLM(documents);
      expect(result).toContain("<title>Untitled</title>");
    });
  });

  describe("formatSearchResultStringForLLM", () => {
    it("should parse and format valid JSON string", () => {
      const documents = [{ title: "Test", content: "Content" }];
      const jsonString = JSON.stringify(documents);

      const result = formatSearchResultStringForLLM(jsonString);
      expect(result).toContain("<title>Test</title>");
      expect(result).toContain("Content");
    });

    it("should return error message for invalid JSON", () => {
      const result = formatSearchResultStringForLLM("invalid json");
      expect(result).toBe("Error processing search results.");
    });

    it("should return error message for non-array JSON", () => {
      const result = formatSearchResultStringForLLM(JSON.stringify({ not: "array" }));
      expect(result).toBe("Invalid search results format.");
    });

    it("should handle empty array JSON string", () => {
      const result = formatSearchResultStringForLLM(JSON.stringify([]));
      expect(result).toBe("No relevant documents found.");
    });
  });

  describe("extractSourcesFromSearchResults", () => {
    it("should return empty array for non-array input", () => {
      expect(extractSourcesFromSearchResults(null)).toEqual([]);
      expect(extractSourcesFromSearchResults(undefined)).toEqual([]);
      expect(extractSourcesFromSearchResults("string")).toEqual([]);
    });

    it("should extract sources with all fields", () => {
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
        score: 0.98, // Uses rerank_score when available
        explanation: { someData: "value" },
      });
    });

    it("should prefer rerank_score over score", () => {
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

    it("should fallback to score when rerank_score is not available", () => {
      const documents = [
        {
          title: "Test",
          score: 0.5,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].score).toBe(0.5);
    });

    it("should handle missing title by using path", () => {
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

    it("should handle missing path by using title", () => {
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

    it("should use 'Untitled' when both title and path are missing", () => {
      const documents = [
        {
          score: 0.7,
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].title).toBe("Untitled");
      expect(sources[0].path).toBe("");
    });

    it("should default score to 0 when missing", () => {
      const documents = [
        {
          title: "Test",
        },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].score).toBe(0);
    });

    it("should preserve null explanation or set to null if missing", () => {
      const documents = [
        { title: "With Explanation", explanation: { data: "test" } },
        { title: "Without Explanation" },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources[0].explanation).toEqual({ data: "test" });
      expect(sources[1].explanation).toBeNull();
    });

    it("should process multiple documents", () => {
      const documents = [
        { title: "Doc1", score: 0.9 },
        { title: "Doc2", score: 0.8 },
        { title: "Doc3", score: 0.7 },
      ];

      const sources = extractSourcesFromSearchResults(documents);
      expect(sources).toHaveLength(3);
      expect(sources.map((s) => s.title)).toEqual(["Doc1", "Doc2", "Doc3"]);
    });
  });

  describe("formatMetadataOnlyDocuments", () => {
    it("should return empty string for empty array", () => {
      expect(formatMetadataOnlyDocuments([])).toBe("");
    });

    it("should return empty string for non-array input", () => {
      expect(formatMetadataOnlyDocuments(null)).toBe("");
      expect(formatMetadataOnlyDocuments(undefined)).toBe("");
    });

    it("should include correct count attribute", () => {
      const docs = [
        { title: "Doc1", content: "Content 1" },
        { title: "Doc2", content: "Content 2" },
        { title: "Doc3", content: "Content 3" },
      ];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain('count="3"');
    });

    it("should include the note attribute", () => {
      const docs = [{ title: "Doc1", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain(
        'note="These results contain titles and metadata only. To read the full content of a note, call the readNote tool with its path."'
      );
    });

    it("should format document with title, path, mtime, and snippet", () => {
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

    it("should truncate content to 300 chars for snippet by default", () => {
      const longContent = "a".repeat(400);
      const docs = [{ title: "Doc", content: longContent }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain(`<snippet>${"a".repeat(300)}</snippet>`);
      expect(result).not.toContain("a".repeat(301));
    });

    it("should respect custom snippetLength parameter", () => {
      const longContent = "b".repeat(200);
      const docs = [{ title: "Doc", content: longContent }];
      const result = formatMetadataOnlyDocuments(docs, 100);
      expect(result).toContain(`<snippet>${"b".repeat(100)}</snippet>`);
      expect(result).not.toContain("b".repeat(101));
    });

    it("should omit path when missing", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<path>");
    });

    it("should omit modified when mtime is missing", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<modified>");
    });

    it("should omit snippet when content is empty", () => {
      const docs = [{ title: "Doc", content: "" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).not.toContain("<snippet>");
    });

    it("should use Untitled for missing title", () => {
      const docs = [{ content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain("<title>Untitled</title>");
    });

    it("should wrap output in additionalMatches element", () => {
      const docs = [{ title: "Doc", content: "Content" }];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toMatch(/^<additionalMatches /);
      expect(result).toMatch(/<\/additionalMatches>$/);
    });

    it("should format multiple documents as file elements", () => {
      const docs = [
        { title: "Doc1", content: "Content 1" },
        { title: "Doc2", content: "Content 2" },
      ];
      const result = formatMetadataOnlyDocuments(docs);
      expect(result).toContain("<title>Doc1</title>");
      expect(result).toContain("<title>Doc2</title>");
    });
  });

  describe("isFilterOnlyResults", () => {
    it("should return false for empty array", () => {
      expect(isFilterOnlyResults([])).toBe(false);
    });

    it("should return false for non-array input", () => {
      expect(isFilterOnlyResults(null as unknown as Array<{ source?: string }>)).toBe(false);
      expect(isFilterOnlyResults(undefined as unknown as Array<{ source?: string }>)).toBe(false);
    });

    it("should return true when all docs have filter sources", () => {
      const docs = [{ source: "time-filtered" }, { source: "tag-match" }];
      expect(isFilterOnlyResults(docs)).toBe(true);
    });

    it("should return false for title-match docs (they get full content)", () => {
      const docs = [{ source: "title-match" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("should return false when title-match is mixed with other filter sources", () => {
      const docs = [{ source: "tag-match" }, { source: "title-match" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("should return false when any doc has a non-filter source", () => {
      const docs = [{ source: "time-filtered" }, { source: "semantic" }];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("should return false when any doc has no source", () => {
      const docs = [{ source: "tag-match" }, {}];
      expect(isFilterOnlyResults(docs)).toBe(false);
    });

    it("should return true for single tag-match doc", () => {
      expect(isFilterOnlyResults([{ source: "tag-match" }])).toBe(true);
    });
  });

  describe("isTimeDominantResults", () => {
    it("should return false for empty array", () => {
      expect(isTimeDominantResults([])).toBe(false);
    });

    it("should return false for non-array input", () => {
      expect(isTimeDominantResults(null as unknown as Array<{ source?: string }>)).toBe(false);
      expect(isTimeDominantResults(undefined as unknown as Array<{ source?: string }>)).toBe(false);
    });

    it("should return true when at least one doc has source time-filtered", () => {
      const docs = [{ source: "tag-match" }, { source: "time-filtered" }];
      expect(isTimeDominantResults(docs)).toBe(true);
    });

    it("should return false when no docs have source time-filtered", () => {
      const docs = [{ source: "tag-match" }, { source: "title-match" }];
      expect(isTimeDominantResults(docs)).toBe(false);
    });

    it("should return true for single time-filtered doc", () => {
      expect(isTimeDominantResults([{ source: "time-filtered" }])).toBe(true);
    });

    it("should return false when source is undefined", () => {
      expect(isTimeDominantResults([{}])).toBe(false);
    });
  });
});
