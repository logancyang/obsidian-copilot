import {
  formatSearchResultsForLLM,
  formatSearchResultStringForLLM,
  extractSourcesFromSearchResults,
} from "./searchResultUtils";

describe("searchResultUtils", () => {
  describe("formatSearchResultsForLLM", () => {
    it("should return empty string for non-array input", () => {
      expect(formatSearchResultsForLLM(null as any)).toBe("");
      expect(formatSearchResultsForLLM(undefined as any)).toBe("");
      expect(formatSearchResultsForLLM("string" as any)).toBe("");
      expect(formatSearchResultsForLLM({} as any)).toBe("");
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
      expect(extractSourcesFromSearchResults(null as any)).toEqual([]);
      expect(extractSourcesFromSearchResults(undefined as any)).toEqual([]);
      expect(extractSourcesFromSearchResults("string" as any)).toEqual([]);
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
});
