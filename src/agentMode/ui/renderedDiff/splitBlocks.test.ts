import type { App } from "obsidian";
import { appParsing } from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";
import { splitMarkdown } from "@/agentMode/ui/renderedDiff/splitBlocks";

describe("splitBlocks", () => {
  describe("splitMarkdown()", () => {
    it("separates a leading frontmatter section, fences included, from the body blocks", async () => {
      const source =
        "---\ntags: [pilot]\n---\n# Alpha pilot\nThe pilot runs in three regions.\n## Rollout\n| Region | Partners |\n| --- | --- |\n| EMEA | 2 |\n\n```bash\nnpm run migrate\n\nnpm run verify\n```\n\n- Kickoff Monday\n- Review Friday\n";
      const app = appParsing({
        sections: [
          ["yaml", 0, 2],
          ["heading", 3, 3],
          ["paragraph", 4, 4],
          ["heading", 5, 5],
          ["table", 6, 8],
          ["code", 10, 14],
          ["list", 16, 17],
        ],
        listItems: [
          [16, 16, -16],
          [17, 17, -16],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split).toEqual({
        frontmatter: "---\ntags: [pilot]\n---",
        blocks: [
          { type: "heading", text: "# Alpha pilot" },
          { type: "text", text: "The pilot runs in three regions." },
          { type: "heading", text: "## Rollout" },
          { type: "table", text: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |" },
          { type: "code", text: "```bash\nnpm run migrate\n\nnpm run verify\n```" },
          { type: "text", text: "- Kickoff Monday" },
          { type: "text", text: "- Review Friday", continuesList: true },
        ],
      });
    });

    it("records the blank lines past the first separator on the block they precede, but not after frontmatter (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const source =
        "---\nstatus: draft\n---\n\n\n# Alpha pilot\n\n\n\nThe pilot runs.\n\n\n- Kickoff\n- Review\n";
      const app = appParsing({
        sections: [
          ["yaml", 0, 2],
          ["heading", 5, 5],
          ["paragraph", 9, 9],
          ["list", 12, 13],
        ],
        listItems: [
          [12, 12, -12],
          [13, 13, -12],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "heading", text: "# Alpha pilot" },
        { type: "text", text: "The pilot runs.", extraBlankLines: 2 },
        { type: "text", text: "- Kickoff", extraBlankLines: 1 },
        { type: "text", text: "- Review", continuesList: true },
      ]);
    });

    it("parses the exact source text it is given, encoded as an ArrayBuffer", async () => {
      const app = appParsing({ sections: [["paragraph", 0, 0]] });

      await splitMarkdown(app, "Héllo\n");

      const [buffer] = (app.metadataCache as unknown as { computeMetadataAsync: jest.Mock })
        .computeMetadataAsync.mock.calls[0];
      expect(new TextDecoder().decode(buffer)).toBe("Héllo\n");
    });

    it("reports null frontmatter when the document has no yaml section", async () => {
      const split = await splitMarkdown(
        appParsing({ sections: [["heading", 0, 0]] }),
        "# Alpha pilot\n"
      );

      expect(split.frontmatter).toBeNull();
      expect(split.blocks).toEqual([{ type: "heading", text: "# Alpha pilot" }]);
    });

    it("classifies callout sections and paragraphs as text blocks", async () => {
      const source = "> [!note]\n> Hi\n\nAfter\n";
      const app = appParsing({
        sections: [
          ["callout", 0, 1],
          ["paragraph", 3, 3],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "text", text: "> [!note]\n> Hi" },
        { type: "text", text: "After" },
      ]);
    });

    it("classifies any paragraph, heading or list item holding an inline %%comment%% as code so its edit stays visible (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const source = "# Plan %%draft%%\n\nAfter\n%%hidden%%\n\n- One\n- Two %%todo%%\n";
      const app = appParsing({
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 3],
          ["list", 5, 6],
        ],
        listItems: [
          [5, 5, -5],
          [6, 6, -5],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "code", text: "# Plan %%draft%%" },
        { type: "code", text: "After\n%%hidden%%" },
        { type: "text", text: "- One" },
        { type: "code", text: "- Two %%todo%%", continuesList: true },
      ]);
    });

    it("classifies comment, reference definition, math and HTML sections as code so a word diff never lands inside them (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const source =
        "Before\n\n%%\nhidden note\nsecond\n%%\n\nSee [ref].\n\n[ref]: https://example.com/a\n\n$$\nx^2\ny^2\n$$\n\n<div>\n  hi\n</div>\n\nAfter\n";
      const app = appParsing({
        sections: [
          ["paragraph", 0, 0],
          ["comment", 2, 5],
          ["paragraph", 7, 7],
          ["definition", 9, 9],
          ["math", 11, 14],
          ["html", 16, 18],
          ["paragraph", 20, 20],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "text", text: "Before" },
        { type: "code", text: "%%\nhidden note\nsecond\n%%" },
        { type: "text", text: "See [ref]." },
        { type: "code", text: "[ref]: https://example.com/a" },
        { type: "code", text: "$$\nx^2\ny^2\n$$" },
        { type: "code", text: "<div>\n  hi\n</div>" },
        { type: "text", text: "After" },
      ]);
    });

    it("skips the empty sections Obsidian appends past a note that ends in a footnote definition (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const app = appParsing({
        sections: [
          ["paragraph", 0, 0],
          ["footnoteDefinition", 2, 2],
          ["text", 3, 3],
          ["element", 3, 3],
        ],
      });

      const split = await splitMarkdown(app, "Body[^1]\n\n[^1]: Footnote text.");

      expect(split.blocks).toEqual([
        { type: "text", text: "Body[^1]" },
        { type: "text", text: "[^1]: Footnote text." },
      ]);
    });

    it("makes each item of a tight list its own block, with nested items and fences staying in their item", async () => {
      const source = "- [ ] a\n  - nested\n- [x] b\n  ```bash\n  x\n  ```\n- c\n\n1. one\n2. two\n";
      const app = appParsing({
        sections: [
          ["list", 0, 6],
          ["list", 8, 9],
        ],
        listItems: [
          [0, 0, -1],
          [1, 1, 0],
          [2, 5, -1],
          [6, 6, -1],
          [8, 8, -8],
          [9, 9, -8],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "text", text: "- [ ] a\n  - nested" },
        { type: "code", text: "- [x] b\n  ```bash\n  x\n  ```", continuesList: true },
        { type: "text", text: "- c", continuesList: true },
        { type: "text", text: "1. one" },
        { type: "text", text: "2. two", continuesList: true },
      ]);
    });

    it("keeps a loose list, whose items blank lines separate, as one block so its paragraph spacing survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const app = appParsing({
        sections: [["list", 0, 2]],
        listItems: [
          [0, 1, -1],
          [2, 2, -1],
        ],
      });

      const split = await splitMarkdown(app, "- a\n\n- b\n");

      expect(split.blocks).toEqual([{ type: "text", text: "- a\n\n- b" }]);
    });

    it("classifies only the item holding a tab-indented fence as code (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", async () => {
      const source = "- one\n- step\n\t```bash\n\tnpm run a\n\n\tnpm run b\n\t```\n- three\n";
      const app = appParsing({
        sections: [["list", 0, 7]],
        listItems: [
          [0, 0, -1],
          [1, 6, -1],
          [7, 7, -1],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks.map((block) => block.type)).toEqual(["text", "code", "text"]);
    });

    it("keeps both lines of a setext heading in one heading block", async () => {
      const split = await splitMarkdown(
        appParsing({ sections: [["heading", 0, 1]] }),
        "Title\n---\n"
      );

      expect(split.blocks).toEqual([{ type: "heading", text: "Title\n---" }]);
    });

    it("keeps inline triple backticks in a paragraph as text and splits the sections after it", async () => {
      const source = "```npm i``` installs deps.\n\n# Next\n\nMore text.\n";
      const app = appParsing({
        sections: [
          ["paragraph", 0, 0],
          ["heading", 2, 2],
          ["paragraph", 4, 4],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.blocks.map((block) => block.type)).toEqual(["text", "heading", "text"]);
    });

    it("classifies a list section holding a tab-indented fence as code so it is never word-diffed (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", async () => {
      const source = "- step\n\t```bash\n\tnpm run a\n\n\tnpm run b\n\t```\n";

      const split = await splitMarkdown(appParsing({ sections: [["list", 0, 5]] }), source);

      expect(split.blocks).toEqual([{ type: "code", text: source.trimEnd() }]);
    });

    it("keeps an unclosed frontmatter fence in the body because the parser reports no yaml section", async () => {
      const source = "---\ntags:\n  - project\n";
      const app = appParsing({
        sections: [
          ["thematicBreak", 0, 0],
          ["paragraph", 1, 1],
          ["list", 2, 2],
        ],
      });

      const split = await splitMarkdown(app, source);

      expect(split.frontmatter).toBeNull();
      expect(split.blocks).toEqual([
        { type: "text", text: "---" },
        { type: "text", text: "tags:" },
        { type: "text", text: "  - project" },
      ]);
    });

    it("returns the same frozen empty block list for every document without sections", async () => {
      const first = await splitMarkdown(appParsing({ sections: [] }), "");
      const second = await splitMarkdown(appParsing({ sections: [] }), "\n  \n");

      expect(first).toEqual({ frontmatter: null, blocks: [] });
      expect(second.blocks).toBe(first.blocks);
      expect(Object.isFrozen(first.blocks)).toBe(true);
    });

    it("rejects when Obsidian does not expose computeMetadataAsync so the caller can fall back to a line diff (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const app = { metadataCache: {} } as unknown as App;

      await expect(splitMarkdown(app, "# Alpha pilot\n")).rejects.toThrow(
        "Obsidian's Markdown parser is unavailable"
      );
    });
  });
});
