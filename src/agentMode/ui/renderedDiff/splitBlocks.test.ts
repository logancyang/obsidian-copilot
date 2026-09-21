import { splitBlocks, splitFrontmatter } from "@/agentMode/ui/renderedDiff/splitBlocks";

describe("splitBlocks", () => {
  describe("splitFrontmatter()", () => {
    it("separates a closed frontmatter block, fences included, from the document body", () => {
      const source = "---\ntags:\n  - project\n---\n\n# Alpha pilot\n";

      expect(splitFrontmatter(source)).toEqual({
        frontmatter: "---\ntags:\n  - project\n---",
        body: "# Alpha pilot\n",
      });
    });

    it("separates unchanged CRLF frontmatter from edited bodies so callers can omit it (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", () => {
      const frontmatter = "---\r\ntags:\r\n  - project\r\n---\r";
      const before = splitFrontmatter(`${frontmatter}\n\r\n# Alpha\r\n\r\nSix weeks.\r\n`);
      const after = splitFrontmatter(`${frontmatter}\n\r\n# Alpha\r\n\r\nEight weeks.\r\n`);

      expect(before).toEqual({ frontmatter, body: "# Alpha\r\n\r\nSix weeks.\r\n" });
      expect(after).toEqual({ frontmatter, body: "# Alpha\r\n\r\nEight weeks.\r\n" });
      expect(before.frontmatter).toBe(after.frontmatter);
    });

    it("reports no frontmatter when the document does not open with a fence", () => {
      const source = "# Alpha pilot\n\n---\n";

      expect(splitFrontmatter(source)).toEqual({ frontmatter: null, body: source });
    });

    it("reports no frontmatter when the opening fence is never closed", () => {
      const source = "---\ntags:\n  - project\n";

      expect(splitFrontmatter(source)).toEqual({ frontmatter: null, body: source });
    });
  });

  describe("splitBlocks()", () => {
    it("returns no blocks for an empty document", () => {
      expect(splitBlocks("")).toEqual([]);
    });

    it("separates headings, paragraphs and lists, dropping the blank lines between them", () => {
      const blocks = splitBlocks("# Alpha\n\nThe pilot runs.\n\n- One\n- Two\n");

      expect(blocks).toEqual([
        { type: "heading", text: "# Alpha" },
        { type: "text", text: "The pilot runs." },
        { type: "text", text: "- One\n- Two" },
      ]);
    });

    it("starts a new block at a heading that follows a paragraph without a blank line", () => {
      const blocks = splitBlocks("The pilot runs.\n## Next\nStaged by region.\n");

      expect(blocks.map((block) => block.type)).toEqual(["text", "heading", "text"]);
      expect(blocks[2].text).toBe("Staged by region.");
    });

    it("keeps a fenced code block whole, including the blank lines inside it", () => {
      const blocks = splitBlocks("```bash\nnpm run migrate\n\nnpm run verify\n```\n\nDone.\n");

      expect(blocks).toEqual([
        { type: "code", text: "```bash\nnpm run migrate\n\nnpm run verify\n```" },
        { type: "text", text: "Done." },
      ]);
    });

    it.each(["```", "~~~"])(
      "closes a CRLF %s code fence before following heading and prose without normalizing source (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)",
      (fence) => {
        const code = `${fence}bash\r\nnpm run migrate\r\n\r\nnpm run verify\r\n${fence}\r`;

        expect(splitBlocks(`${code}\n## Next\r\nDone.\r\n`)).toEqual([
          { type: "code", text: code },
          { type: "heading", text: "## Next\r" },
          { type: "text", text: "Done.\r" },
        ]);
      }
    );

    it("keeps a table whole and separate from the paragraph directly above it", () => {
      const blocks = splitBlocks("Capacity:\n| Region | Partners |\n| --- | --- |\n| EMEA | 2 |\n");

      expect(blocks).toEqual([
        { type: "text", text: "Capacity:" },
        { type: "table", text: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |" },
      ]);
    });

    it("recognises a thematic break as a block of its own", () => {
      const blocks = splitBlocks("Above.\n\n---\n\nBelow.\n");

      expect(blocks.map((block) => block.type)).toEqual(["text", "thematicBreak", "text"]);
    });
  });
});
