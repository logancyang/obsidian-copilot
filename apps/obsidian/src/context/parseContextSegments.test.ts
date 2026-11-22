import { parseContextIntoSegments } from "@/context/parseContextSegments";
import { CONTEXT_BLOCK_TYPES } from "@/context/contextBlockRegistry";

describe("parseContextSegments", () => {
  describe("parseContextIntoSegments()", () => {
    it("parses a note_context block into a current-turn segment identified by its note path", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Some content</content>
</note_context>`;

      const segments = parseContextIntoSegments(xml, false);

      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        id: "folder/my-note.md",
        content: xml,
        stable: false,
        metadata: { source: "current_turn", notePath: "folder/my-note.md" },
      });
    });

    it("identifies a url_content block by its URL and sets no note path", () => {
      const xml = `<url_content>
<url>https://example.com/page</url>
<content>Page content here</content>
</url_content>`;

      const [segment] = parseContextIntoSegments(xml, false);

      expect(segment.id).toBe("https://example.com/page");
      expect(segment.content).toBe(xml);
      expect(segment.metadata?.notePath).toBeUndefined();
    });

    it("identifies an embedded_pdf block by its name", () => {
      const xml = `<embedded_pdf>
<name>document.pdf</name>
<content>PDF text content</content>
</embedded_pdf>`;

      expect(parseContextIntoSegments(xml, false)[0].id).toBe("document.pdf");
    });

    it("marks segments as stable previous-turn context when stable is true", () => {
      const xml = `<active_note>
<title>Active</title>
<path>active.md</path>
<content>Active content</content>
</active_note>`;

      const [segment] = parseContextIntoSegments(xml, true);

      expect(segment.stable).toBe(true);
      expect(segment.metadata).toMatchObject({ source: "previous_turns", notePath: "active.md" });
    });

    it("parses prior_context blocks as compacted previous-turn segments identified by their source attribute", () => {
      const xml = `<prior_context source="folder/old-note.md" type="note">
Compacted summary of old note
</prior_context>`;

      const [segment] = parseContextIntoSegments(xml, true);

      expect(segment).toMatchObject({
        id: "folder/old-note.md",
        metadata: { source: "previous_turns_compacted", notePath: "folder/old-note.md" },
      });
    });

    it("identifies a prior_context block without a source attribute as prior_context", () => {
      const xml = `<prior_context>
Compacted content
</prior_context>`;

      expect(parseContextIntoSegments(xml, true)[0].id).toBe("prior_context");
    });

    it("parses blocks of different types in document order", () => {
      const xml = `<note_context>
<title>Note</title>
<path>notes/test.md</path>
<content>Note content</content>
</note_context>

<url_content>
<url>https://example.com</url>
<content>URL content</content>
</url_content>

<prior_context source="old/note.md" type="note">
Compacted note
</prior_context>`;

      const segments = parseContextIntoSegments(xml, false);

      expect(segments.map((s) => s.id)).toEqual([
        "notes/test.md",
        "https://example.com",
        "old/note.md",
      ]);
    });

    it("identifies a selected_text block by its tag because it has no source extractor", () => {
      const xml = `<selected_text>
<content>User selected this text</content>
</selected_text>`;

      expect(parseContextIntoSegments(xml, false)[0].id).toBe("selected_text");
    });

    it("gives repeated selected_text blocks unique, numbered ids", () => {
      const xml = `<selected_text>
<content>First selection</content>
</selected_text>

<selected_text>
<content>Second selection</content>
</selected_text>`;

      const segments = parseContextIntoSegments(xml, false);

      expect(segments.map((s) => s.id)).toEqual(["selected_text", "selected_text:2"]);
    });

    it("parses every block type registered in CONTEXT_BLOCK_TYPES", () => {
      for (const blockType of CONTEXT_BLOCK_TYPES) {
        const tag = blockType.tag;
        let xml: string;

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

    it("returns no segments for an empty or whitespace-only string", () => {
      expect(parseContextIntoSegments("", false)).toEqual([]);
      expect(parseContextIntoSegments("   \n  ", false)).toEqual([]);
    });

    it("returns no segments for plain text or unregistered XML tags", () => {
      expect(parseContextIntoSegments("Just some plain text", false)).toEqual([]);
      expect(
        parseContextIntoSegments("<unknown_tag><content>Something</content></unknown_tag>", false)
      ).toEqual([]);
    });
  });
});
