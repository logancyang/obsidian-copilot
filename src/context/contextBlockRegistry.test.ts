import {
  getBlockType,
  getSourceType,
  isRecoverable,
  getNeverCompactTags,
  extractSourceFromBlock,
  extractContentFromBlock,
  detectBlockTag,
  CONTEXT_BLOCK_TYPES,
} from "./contextBlockRegistry";

describe("contextBlockRegistry", () => {
  describe("CONTEXT_BLOCK_TYPES", () => {
    it("should have all expected block types registered", () => {
      const tags = CONTEXT_BLOCK_TYPES.map((bt) => bt.tag);
      expect(tags).toContain("note_context");
      expect(tags).toContain("active_note");
      expect(tags).toContain("url_content");
      expect(tags).toContain("youtube_video_context");
      expect(tags).toContain("selected_text");
      expect(tags).toContain("localSearch");
    });
  });

  describe("getBlockType", () => {
    it("should return block type for known tags", () => {
      const noteContext = getBlockType("note_context");
      expect(noteContext).toBeDefined();
      expect(noteContext?.sourceType).toBe("note");
      expect(noteContext?.recoverable).toBe(true);
    });

    it("should return undefined for unknown tags", () => {
      expect(getBlockType("unknown_tag")).toBeUndefined();
    });
  });

  describe("getSourceType", () => {
    it("should return correct source type for note blocks", () => {
      expect(getSourceType("note_context")).toBe("note");
      expect(getSourceType("active_note")).toBe("note");
      expect(getSourceType("embedded_note")).toBe("note");
    });

    it("should return correct source type for URL blocks", () => {
      expect(getSourceType("url_content")).toBe("url");
      expect(getSourceType("web_tab_context")).toBe("url");
    });

    it("should return correct source type for YouTube blocks", () => {
      expect(getSourceType("youtube_video_context")).toBe("youtube");
    });

    it("should return unknown for unregistered tags", () => {
      expect(getSourceType("random_tag")).toBe("unknown");
    });
  });

  describe("isRecoverable", () => {
    it("should return true for recoverable types", () => {
      expect(isRecoverable("note_context")).toBe(true);
      expect(isRecoverable("url_content")).toBe(true);
      expect(isRecoverable("youtube_video_context")).toBe(true);
    });

    it("should return false for non-recoverable types", () => {
      expect(isRecoverable("selected_text")).toBe(false);
      expect(isRecoverable("web_selected_text")).toBe(false);
    });

    it("should return false for unknown types", () => {
      expect(isRecoverable("unknown_type")).toBe(false);
    });
  });

  describe("getNeverCompactTags", () => {
    it("should return set of non-recoverable tags", () => {
      const tags = getNeverCompactTags();
      expect(tags.has("selected_text")).toBe(true);
      expect(tags.has("web_selected_text")).toBe(true);
      expect(tags.has("note_context")).toBe(false);
    });
  });

  describe("extractSourceFromBlock", () => {
    it("should extract path from note blocks", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Content here</content>
</note_context>`;
      expect(extractSourceFromBlock(xml, "note_context")).toBe("folder/my-note.md");
    });

    it("should extract URL from url_content blocks", () => {
      const xml = `<url_content>
<url>https://example.com/page</url>
<content>Content</content>
</url_content>`;
      expect(extractSourceFromBlock(xml, "url_content")).toBe("https://example.com/page");
    });

    it("should extract name from PDF blocks", () => {
      const xml = `<embedded_pdf>
<name>document.pdf</name>
<content>PDF content</content>
</embedded_pdf>`;
      expect(extractSourceFromBlock(xml, "embedded_pdf")).toBe("document.pdf");
    });

    it("should return empty string for blocks without source extractor", () => {
      const xml = `<selected_text><content>Just text</content></selected_text>`;
      expect(extractSourceFromBlock(xml, "selected_text")).toBe("");
    });
  });

  describe("extractContentFromBlock", () => {
    it("should extract content from content tags", () => {
      const xml = `<note_context>
<title>Title</title>
<content>This is the content</content>
</note_context>`;
      expect(extractContentFromBlock(xml)).toBe("This is the content");
    });

    it("should return whole block if no content tags", () => {
      const xml = "<note>Plain text</note>";
      expect(extractContentFromBlock(xml)).toBe(xml);
    });
  });

  describe("detectBlockTag", () => {
    it("should detect tag from block start", () => {
      expect(detectBlockTag("<note_context>...</note_context>")).toBe("note_context");
      expect(detectBlockTag('<url_content attr="value">...</url_content>')).toBe("url_content");
    });

    it("should return null for invalid blocks", () => {
      expect(detectBlockTag("not xml")).toBeNull();
      expect(detectBlockTag("")).toBeNull();
    });
  });
});
