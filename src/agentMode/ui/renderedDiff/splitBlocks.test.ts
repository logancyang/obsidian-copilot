import { splitBlocks, splitFrontmatter } from "@/agentMode/ui/renderedDiff/splitBlocks";

describe("splitBlocks", () => {
  describe("splitFrontmatter()", () => {
    it("separates a closed frontmatter block, fences included, from the document body", () => {
      const source = "---\ntags:\n  - project\n---\n\n# Alpha pilot\n";

      expect(splitFrontmatter(source)).toEqual({
        frontmatter: "---\ntags:\n  - project\n---",
        body: "\n# Alpha pilot\n",
      });
    });

    it("accepts fences followed by trailing spaces or tabs, as Obsidian does", () => {
      const source = "--- \ntags:\n  - project\n---\t\n# Alpha pilot\n";

      expect(splitFrontmatter(source)).toEqual({
        frontmatter: "--- \ntags:\n  - project\n---\t",
        body: "# Alpha pilot\n",
      });
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
    it("returns the same empty block list for every empty or whitespace-only document", () => {
      expect(splitBlocks("")).toEqual([]);
      expect(splitBlocks("\n  \n")).toBe(splitBlocks(""));
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

    it("keeps a table whole and separate from the paragraph directly above it", () => {
      const blocks = splitBlocks("Capacity:\n| Region | Partners |\n| --- | --- |\n| EMEA | 2 |\n");

      expect(blocks).toEqual([
        { type: "text", text: "Capacity:" },
        { type: "table", text: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |" },
      ]);
    });

    it("treats a pipe line followed by a malformed 50,000-character delimiter as prose", () => {
      const text = `| Region |\n|${"-".repeat(50_000)}x`;

      expect(splitBlocks(text)).toEqual([{ type: "text", text }]);
    });

    it("keeps a setext heading underline with its title so the heading still renders", () => {
      expect(splitBlocks("Title\n---\n")).toEqual([{ type: "text", text: "Title\n---" }]);
    });
  });
});
