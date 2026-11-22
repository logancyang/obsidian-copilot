import { compactL3ForL2, compactXmlBlock, getL2RefetchInstruction } from "./L2ContextCompactor";

describe("L2ContextCompactor", () => {
  describe("compactL3ForL2()", () => {
    it("returns content under the verbatim threshold unchanged", () => {
      const content = "Small content";
      expect(compactL3ForL2(content, "notes/test.md", "note")).toBe(content);
    });

    it("wraps oversized content in a prior_context block that keeps every heading", () => {
      const content = `## Section 1
${"A".repeat(2000)}

## Section 2
${"B".repeat(2000)}`;

      const result = compactL3ForL2(content, "notes/research.md", "note", {
        verbatimThreshold: 1000,
        previewCharsPerSection: 100,
      });

      expect(result).toContain('<prior_context source="notes/research.md" type="note">');
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
      expect(result).toContain("</prior_context>");
      expect(result.length).toBeLessThan(content.length);
    });

    it("records the given source type on the prior_context block", () => {
      const result = compactL3ForL2("A".repeat(10000), "https://example.com", "url", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('type="url"');
      expect(result).toContain('source="https://example.com"');
    });

    it("escapes XML special characters in the source attribute", () => {
      const result = compactL3ForL2("A".repeat(10000), 'path/with"quotes&special<chars>', "note", {
        verbatimThreshold: 1000,
      });

      expect(result).toContain('source="path/with&quot;quotes&amp;special&lt;chars&gt;"');
    });
  });

  describe("compactXmlBlock()", () => {
    it("returns a block under the verbatim threshold unchanged", () => {
      const xml = `<note_context>
<title>Short Note</title>
<path>notes/short.md</path>
<content>Brief content.</content>
</note_context>`;

      expect(compactXmlBlock(xml, "note_context")).toBe(xml);
    });

    it("compacts an oversized note block into a prior_context preview keeping its headings", () => {
      const xml = `<note_context>
<title>Research Paper</title>
<path>research/paper.md</path>
<content>## Introduction
${"X".repeat(3000)}

## Details
${"Y".repeat(3000)}</content>
</note_context>`;

      const result = compactXmlBlock(xml, "note_context", {
        verbatimThreshold: 1000,
        previewCharsPerSection: 200,
      });

      expect(result).toContain('<prior_context source="research/paper.md" type="note">');
      expect(result).toContain("## Introduction");
      expect(result).toContain("## Details");
      expect(result.length).toBeLessThan(xml.length);
    });

    it.each([
      ["url_content", "url", "url", "https://example.com/article"],
      ["youtube_video_context", "youtube", "url", "https://www.youtube.com/watch?v=abc123"],
      ["embedded_pdf", "pdf", "name", "documents/report.pdf"],
    ])("labels an oversized %s block with source type %s", (tag, type, sourceTag, source) => {
      const xml = `<${tag}>
<${sourceTag}>${source}</${sourceTag}>
<content>${"A".repeat(10000)}</content>
</${tag}>`;

      const result = compactXmlBlock(xml, tag, { verbatimThreshold: 1000 });

      expect(result).toContain(`source="${source}"`);
      expect(result).toContain(`type="${type}"`);
    });

    it.each(["selected_text", "web_selected_text"])(
      "never compacts a %s block however large",
      (tag) => {
        const xml = `<${tag}>
<title>User Selection</title>
<content>${"A".repeat(20000)}</content>
</${tag}>`;

        const result = compactXmlBlock(xml, tag, { verbatimThreshold: 1000 });

        expect(result).toBe(xml);
      }
    );
  });

  describe("getL2RefetchInstruction()", () => {
    it("tells the model how to re-fetch full content behind prior_context previews", () => {
      const instruction = getL2RefetchInstruction();

      expect(instruction).toContain("prior_context_note");
      expect(instruction).toContain("previews");
      expect(instruction).toContain("[[note title]]");
    });
  });
});
