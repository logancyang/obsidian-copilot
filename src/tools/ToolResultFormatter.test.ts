import { deriveReadNoteDisplayName, ToolResultFormatter } from "./ToolResultFormatter";

describe("ToolResultFormatter", () => {
  describe("formatLocalSearch", () => {
    it("should handle XML-wrapped search results", () => {
      const xmlResult = `<localSearch>
<document>
<title>First Note</title>
<path>folder/first.md</path>
<modified>2024-01-01T00:00:00.000Z</modified>
<content>
This is the first note content.
</content>
</document>
<document>
<title>Second Note</title>
<path>second.md</path>
<content>
This is the second note content.
</content>
</document>
</localSearch>`;

      const formatted = ToolResultFormatter.format("localSearch", xmlResult);

      expect(formatted).toContain("📚 Found 2 relevant notes");
      expect(formatted).toContain("1. First Note");
      expect(formatted).toContain("📁 folder/first.md");
      expect(formatted).toContain("🕒 Modified: 2024-01-01T00:00:00.000Z");
      expect(formatted).toContain("2. Second Note");
      expect(formatted).toContain("📁 second.md");
      expect(formatted).not.toContain("undefined");
      expect(formatted).not.toContain("null");
    });

    it("should handle XML-wrapped results with timeRange attribute", () => {
      const xmlResult = `<localSearch timeRange="last week">
<document>
<title>Recent Note</title>
<modified>2024-01-15T00:00:00.000Z</modified>
<content>
Recent content.
</content>
</document>
</localSearch>`;

      const formatted = ToolResultFormatter.format("localSearch", xmlResult);

      expect(formatted).toContain("📚 Found 1 relevant notes");
      expect(formatted).toContain("1. Recent Note");
      expect(formatted).toContain("🕒 Modified: 2024-01-15T00:00:00.000Z");
    });

    it("should handle empty XML-wrapped results", () => {
      const xmlResult = `<localSearch>
</localSearch>`;

      const formatted = ToolResultFormatter.format("localSearch", xmlResult);

      expect(formatted).toBe("📚 Found 0 relevant notes\n\nNo matching notes found.");
    });

    it("should handle more than 10 XML results", () => {
      let xmlContent = "";
      for (let i = 1; i <= 15; i++) {
        xmlContent += `<document>
<title>Note ${i}</title>
<content>Content ${i}</content>
</document>
`;
      }
      const xmlResult = `<localSearch>${xmlContent}</localSearch>`;

      const formatted = ToolResultFormatter.format("localSearch", xmlResult);

      expect(formatted).toContain("📚 Found 15 relevant notes");
      expect(formatted).toContain("1. Note 1");
      expect(formatted).toContain("10. Note 10");
      expect(formatted).not.toContain("11. Note 11");
      expect(formatted).toContain("... and 5 more results");
    });

    it("should support structured JSON fallback when not XML", () => {
      const jsonResult = JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "JSON Note",
            path: "json/note.md",
            score: 0.95,
            content: "JSON content",
          },
        ],
      });

      const formatted = ToolResultFormatter.format("localSearch", jsonResult);

      expect(formatted).toContain("📚 Found 1 relevant notes");
      expect(formatted).toContain("1. note");
      expect(formatted).toContain("📊 Relevance: 0.9500");
    });

    it("should handle encoded XML results", () => {
      const xmlResult = `<localSearch>
<document>
<title>Encoded Note</title>
<content>
Content with special chars &lt;tag&gt; &amp; more
</content>
</document>
</localSearch>`;
      const encoded = "ENC:" + encodeURIComponent(xmlResult);

      const formatted = ToolResultFormatter.format("localSearch", encoded);

      expect(formatted).toContain("📚 Found 1 relevant notes");
      expect(formatted).toContain("1. Encoded Note");
    });

    it("should handle documents without optional fields", () => {
      const xmlResult = `<localSearch>
<document>
<title>Minimal Note</title>
<content>
Just content, no path or modified date
</content>
</document>
</localSearch>`;

      const formatted = ToolResultFormatter.format("localSearch", xmlResult);

      expect(formatted).toContain("📚 Found 1 relevant notes");
      expect(formatted).toContain("1. Minimal Note");
      expect(formatted).not.toContain("📁");
      expect(formatted).not.toContain("🕒");
    });

    it("should handle malformed XML gracefully", () => {
      const malformedXml = "<localSearch>not valid xml";

      const formatted = ToolResultFormatter.format("localSearch", malformedXml);

      // The XML regex matches and extracts content even if it's not well-formed XML
      // It finds 0 documents and returns the "no results" message
      expect(formatted).toBe("📚 Found 0 relevant notes\n\nNo matching notes found.");
    });
  });

  describe("formatWebSearch", () => {
    it("should handle new JSON array format", () => {
      const result = [
        {
          type: "web_search",
          content: "Web search content here",
          citations: ["https://example.com", "https://example.org"],
          instruction: "Use this information to answer the question",
        },
      ];

      const formatted = ToolResultFormatter.format("webSearch", JSON.stringify(result));

      expect(formatted).toContain("🌐 Web Search Results");
      expect(formatted).toContain("Web search content here");
      expect(formatted).toContain("[1] https://example.com");
      expect(formatted).toContain("[2] https://example.org");
      expect(formatted).toContain("Note: Use this information");
    });
  });

  describe("format", () => {
    it("should return raw result for unknown tool names", () => {
      const result = "Some unknown tool result";

      const formatted = ToolResultFormatter.format("unknownTool", result);

      expect(formatted).toBe(result);
    });

    it("should handle exceptions gracefully", () => {
      // Pass null which will cause an error in parsing
      const formatted = ToolResultFormatter.format("localSearch", null as any);

      // The formatLocalSearch method converts null to string "null"
      // which doesn't match the XML pattern, so it falls back to parseSearchResults
      // which returns empty array for "null" string, resulting in "no results" message
      expect(formatted).toBe("📚 Found 0 relevant notes\n\nNo matching notes found.");
    });
  });

  describe("deriveReadNoteDisplayName", () => {
    it("returns a generic label when the input is blank", () => {
      expect(deriveReadNoteDisplayName("")).toBe("note");
      expect(deriveReadNoteDisplayName("   ")).toBe("note");
    });

    it("strips wiki-link syntax, aliases, sections, and extensions", () => {
      expect(deriveReadNoteDisplayName("[[Projects/Plan.md]]")).toBe("Plan");
      expect(deriveReadNoteDisplayName("[[Projects/Plan.md|Project Plan]]")).toBe("Project Plan");
      expect(deriveReadNoteDisplayName("[[Docs/Guide#Setup|Quick Start]]")).toBe("Quick Start");
      expect(deriveReadNoteDisplayName("[[Area/Tasks.canvas]]")).toBe("Tasks");
    });

    it("returns the last path segment when no wiki syntax is present", () => {
      expect(deriveReadNoteDisplayName("Area/Deep/Notes/Plan.md")).toBe("Plan");
      expect(deriveReadNoteDisplayName("Area/Deep/Notes")).toBe("Notes");
    });
  });
});
