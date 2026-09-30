import {
  getSourceType,
  isRecoverable,
  extractSourceFromBlock,
  extractContentFromBlock,
  CONTEXT_BLOCK_TYPES,
} from "./contextBlockRegistry";

describe("contextBlockRegistry", () => {
  describe("CONTEXT_BLOCK_TYPES", () => {
    it("registers every context block tag the prompt builders emit", () => {
      const tags = CONTEXT_BLOCK_TYPES.map((bt) => bt.tag);
      expect(tags).toContain("note_context");
      expect(tags).toContain("active_note");
      expect(tags).toContain("url_content");
      expect(tags).toContain("youtube_video_context");
      expect(tags).toContain("twitter_content");
      expect(tags).toContain("selected_text");
      expect(tags).toContain("localSearch");
    });
  });

  describe("getSourceType()", () => {
    it("classifies note-producing tags as note", () => {
      expect(getSourceType("note_context")).toBe("note");
      expect(getSourceType("active_note")).toBe("note");
      expect(getSourceType("embedded_note")).toBe("note");
    });

    it("classifies web and tweet tags as url", () => {
      expect(getSourceType("url_content")).toBe("url");
      expect(getSourceType("web_tab_context")).toBe("url");
      expect(getSourceType("twitter_content")).toBe("url");
    });

    it("classifies the YouTube tag as youtube", () => {
      expect(getSourceType("youtube_video_context")).toBe("youtube");
    });

    it("returns pdf and selected_text for their registered tags", () => {
      expect(getSourceType("embedded_pdf")).toBe("pdf");
      expect(getSourceType("selected_text")).toBe("selected_text");
      expect(getSourceType("web_selected_text")).toBe("selected_text");
    });

    it("returns unknown for an unregistered tag", () => {
      expect(getSourceType("random_tag")).toBe("unknown");
    });
  });

  describe("isRecoverable()", () => {
    it("marks note, URL, YouTube, and tweet blocks as recoverable", () => {
      expect(isRecoverable("note_context")).toBe(true);
      expect(isRecoverable("url_content")).toBe(true);
      expect(isRecoverable("youtube_video_context")).toBe(true);
      expect(isRecoverable("twitter_content")).toBe(true);
    });

    it("marks selected-text blocks as not recoverable", () => {
      expect(isRecoverable("selected_text")).toBe(false);
      expect(isRecoverable("web_selected_text")).toBe(false);
    });

    it("treats an unregistered tag as not recoverable", () => {
      expect(isRecoverable("unknown_type")).toBe(false);
    });
  });

  describe("extractSourceFromBlock()", () => {
    it("extracts the path from a note block", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Content here</content>
</note_context>`;
      expect(extractSourceFromBlock(xml, "note_context")).toBe("folder/my-note.md");
    });

    it("extracts the URL from a url_content block", () => {
      const xml = `<url_content>
<url>https://example.com/page</url>
<content>Content</content>
</url_content>`;
      expect(extractSourceFromBlock(xml, "url_content")).toBe("https://example.com/page");
    });

    it("extracts the name from a PDF block", () => {
      const xml = `<embedded_pdf>
<name>document.pdf</name>
<content>PDF content</content>
</embedded_pdf>`;
      expect(extractSourceFromBlock(xml, "embedded_pdf")).toBe("document.pdf");
    });

    it("extracts the URL from a twitter_content block", () => {
      const xml = `<twitter_content>
<url>https://x.com/user/status/123</url>
<content>Tweet</content>
</twitter_content>`;
      expect(extractSourceFromBlock(xml, "twitter_content")).toBe("https://x.com/user/status/123");
    });

    it("returns an empty string for a block type with no source extractor", () => {
      const xml = `<selected_text><content>Just text</content></selected_text>`;
      expect(extractSourceFromBlock(xml, "selected_text")).toBe("");
    });
  });

  describe("extractContentFromBlock()", () => {
    it("returns the text inside the content tag", () => {
      const xml = `<note_context>
<title>Title</title>
<content>This is the content</content>
</note_context>`;
      expect(extractContentFromBlock(xml)).toBe("This is the content");
    });

    it("returns the whole block when it has no content tag", () => {
      const xml = "<note>Plain text</note>";
      expect(extractContentFromBlock(xml)).toBe(xml);
    });
  });
});
