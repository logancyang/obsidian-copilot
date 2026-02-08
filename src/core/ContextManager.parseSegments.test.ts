import { parseContextIntoSegments } from "@/context/parseContextSegments";
import { CONTEXT_BLOCK_TYPES } from "@/context/contextBlockRegistry";

describe("parseContextIntoSegments", () => {
  describe("empty input", () => {
    it("should return empty array for empty string", () => {
      expect(parseContextIntoSegments("", false)).toEqual([]);
    });

    it("should return empty array for whitespace-only string", () => {
      expect(parseContextIntoSegments("   \n  ", false)).toEqual([]);
    });
  });

  describe("note blocks", () => {
    it("should parse note_context blocks with path as ID", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Some content</content>
</note_context>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("folder/my-note.md");
      expect(segments[0].content).toBe(xml);
      expect(segments[0].stable).toBe(false);
      expect(segments[0].metadata?.source).toBe("current_turn");
      expect(segments[0].metadata?.notePath).toBe("folder/my-note.md");
    });

    it("should parse active_note blocks", () => {
      const xml = `<active_note>
<title>Active</title>
<path>active.md</path>
<content>Active content</content>
</active_note>`;
      const segments = parseContextIntoSegments(xml, true);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("active.md");
      expect(segments[0].metadata?.source).toBe("previous_turns");
      expect(segments[0].metadata?.notePath).toBe("active.md");
    });
  });

  describe("URL blocks", () => {
    it("should parse url_content blocks with URL as ID", () => {
      const xml = `<url_content>
<url>https://example.com/page</url>
<content>Page content here</content>
</url_content>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("https://example.com/page");
      expect(segments[0].content).toBe(xml);
      expect(segments[0].metadata?.source).toBe("current_turn");
      expect(segments[0].metadata?.notePath).toBeUndefined();
    });

    it("should parse web_tab_context blocks", () => {
      const xml = `<web_tab_context>
<url>https://docs.example.com</url>
<content>Documentation</content>
</web_tab_context>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("https://docs.example.com");
    });
  });

  describe("YouTube blocks", () => {
    it("should parse youtube_video_context blocks with URL as ID", () => {
      const xml = `<youtube_video_context>
<url>https://www.youtube.com/watch?v=abc123</url>
<content>Transcript of the video</content>
</youtube_video_context>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("https://www.youtube.com/watch?v=abc123");
      expect(segments[0].content).toBe(xml);
      expect(segments[0].metadata?.source).toBe("current_turn");
      expect(segments[0].metadata?.notePath).toBeUndefined();
    });
  });

  describe("Twitter blocks", () => {
    it("should parse twitter_content blocks with URL as ID", () => {
      const xml = `<twitter_content>
<url>https://x.com/user/status/123</url>
<content>Tweet content</content>
</twitter_content>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("https://x.com/user/status/123");
      expect(segments[0].metadata?.source).toBe("current_turn");
    });
  });

  describe("PDF blocks", () => {
    it("should parse embedded_pdf blocks with name as ID", () => {
      const xml = `<embedded_pdf>
<name>document.pdf</name>
<content>PDF text content</content>
</embedded_pdf>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("document.pdf");
    });
  });

  describe("selected_text blocks", () => {
    it("should parse selected_text blocks with tag as ID (no source extractor)", () => {
      const xml = `<selected_text>
<content>User selected this text</content>
</selected_text>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("selected_text");
    });

    it("should assign unique IDs to multiple selected_text blocks", () => {
      const xml = `<selected_text>
<content>First selection</content>
</selected_text>

<selected_text>
<content>Second selection</content>
</selected_text>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(2);
      expect(segments[0].id).toBe("selected_text");
      expect(segments[1].id).toBe("selected_text:2");
    });
  });

  describe("prior_context blocks (compaction artifacts)", () => {
    it("should parse prior_context blocks with source attribute as ID", () => {
      const xml = `<prior_context source="folder/old-note.md" type="note">
Compacted summary of old note
</prior_context>`;
      const segments = parseContextIntoSegments(xml, true);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("folder/old-note.md");
      expect(segments[0].metadata?.source).toBe("previous_turns_compacted");
      expect(segments[0].metadata?.notePath).toBe("folder/old-note.md");
    });

    it("should fall back to 'prior_context' as ID when no source attribute", () => {
      const xml = `<prior_context>
Compacted content
</prior_context>`;
      const segments = parseContextIntoSegments(xml, true);
      expect(segments).toHaveLength(1);
      expect(segments[0].id).toBe("prior_context");
    });
  });

  describe("stable flag", () => {
    it("should set metadata.source to 'previous_turns' when stable=true", () => {
      const xml = `<url_content>
<url>https://example.com</url>
<content>Content</content>
</url_content>`;
      const segments = parseContextIntoSegments(xml, true);
      expect(segments[0].stable).toBe(true);
      expect(segments[0].metadata?.source).toBe("previous_turns");
    });

    it("should set metadata.source to 'current_turn' when stable=false", () => {
      const xml = `<url_content>
<url>https://example.com</url>
<content>Content</content>
</url_content>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments[0].stable).toBe(false);
      expect(segments[0].metadata?.source).toBe("current_turn");
    });
  });

  describe("mixed block types", () => {
    it("should parse multiple different block types from a single string", () => {
      const xml = `<note_context>
<title>Note</title>
<path>notes/test.md</path>
<content>Note content</content>
</note_context>

<url_content>
<url>https://example.com</url>
<content>URL content</content>
</url_content>

<youtube_video_context>
<url>https://youtube.com/watch?v=xyz</url>
<content>Transcript</content>
</youtube_video_context>

<prior_context source="old/note.md" type="note">
Compacted note
</prior_context>`;

      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(4);
      expect(segments[0].id).toBe("notes/test.md");
      expect(segments[1].id).toBe("https://example.com");
      expect(segments[2].id).toBe("https://youtube.com/watch?v=xyz");
      expect(segments[3].id).toBe("old/note.md");
    });

    it("should parse multiple blocks of the same type", () => {
      const xml = `<note_context>
<title>Note 1</title>
<path>note1.md</path>
<content>Content 1</content>
</note_context>

<note_context>
<title>Note 2</title>
<path>note2.md</path>
<content>Content 2</content>
</note_context>`;

      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toHaveLength(2);
      expect(segments[0].id).toBe("note1.md");
      expect(segments[1].id).toBe("note2.md");
    });
  });

  describe("registry completeness", () => {
    it("should parse every block type registered in CONTEXT_BLOCK_TYPES", () => {
      for (const blockType of CONTEXT_BLOCK_TYPES) {
        const tag = blockType.tag;
        let xml: string;

        // Build a valid XML block based on the source extractor type
        switch (blockType.sourceExtractor) {
          case "path":
            xml = `<${tag}><path>test/file.md</path><content>test</content></${tag}>`;
            break;
          case "url":
            xml = `<${tag}><url>https://example.com</url><content>test</content></${tag}>`;
            break;
          case "name":
            xml = `<${tag}><name>file.pdf</name><content>test</content></${tag}>`;
            break;
          default:
            xml = `<${tag}><content>test</content></${tag}>`;
            break;
        }

        const segments = parseContextIntoSegments(xml, false);
        expect(segments).toHaveLength(1);
        expect(segments[0].content).toBe(xml);
      }
    });
  });

  describe("non-matching content", () => {
    it("should return empty array for plain text without XML blocks", () => {
      const segments = parseContextIntoSegments("Just some plain text", false);
      expect(segments).toEqual([]);
    });

    it("should return empty array for unregistered XML tags", () => {
      const xml = `<unknown_tag><content>Something</content></unknown_tag>`;
      const segments = parseContextIntoSegments(xml, false);
      expect(segments).toEqual([]);
    });
  });
});
