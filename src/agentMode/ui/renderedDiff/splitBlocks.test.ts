import type { App } from "obsidian";
import { splitMarkdown } from "@/agentMode/ui/renderedDiff/splitBlocks";

type RecordedSection = [type: string, startLine: number, endLine: number];

function appParsing(sections: RecordedSection[]): App {
  const computeMetadataAsync = jest.fn(async () => ({
    sections: sections.map(([type, start, end]) => ({
      type,
      position: { start: { line: start }, end: { line: end } },
    })),
  }));
  return { metadataCache: { computeMetadataAsync } } as unknown as App;
}

describe("splitBlocks", () => {
  describe("splitMarkdown()", () => {
    it("separates a leading frontmatter section, fences included, from the body blocks", async () => {
      const source =
        "---\ntags: [pilot]\n---\n# Alpha pilot\nThe pilot runs in three regions.\n## Rollout\n| Region | Partners |\n| --- | --- |\n| EMEA | 2 |\n\n```bash\nnpm run migrate\n\nnpm run verify\n```\n\n- Kickoff Monday\n- Review Friday\n";
      const app = appParsing([
        ["yaml", 0, 2],
        ["heading", 3, 3],
        ["paragraph", 4, 4],
        ["heading", 5, 5],
        ["table", 6, 8],
        ["code", 10, 14],
        ["list", 16, 17],
      ]);

      const split = await splitMarkdown(app, source);

      expect(split).toEqual({
        frontmatter: "---\ntags: [pilot]\n---",
        blocks: [
          { type: "heading", text: "# Alpha pilot" },
          { type: "text", text: "The pilot runs in three regions." },
          { type: "heading", text: "## Rollout" },
          { type: "table", text: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |" },
          { type: "code", text: "```bash\nnpm run migrate\n\nnpm run verify\n```" },
          { type: "text", text: "- Kickoff Monday\n- Review Friday" },
        ],
      });
    });

    it("parses the exact source text it is given, encoded as an ArrayBuffer", async () => {
      const app = appParsing([["paragraph", 0, 0]]);

      await splitMarkdown(app, "Héllo\n");

      const [buffer] = (app.metadataCache as unknown as { computeMetadataAsync: jest.Mock })
        .computeMetadataAsync.mock.calls[0];
      expect(new TextDecoder().decode(buffer)).toBe("Héllo\n");
    });

    it("reports null frontmatter when the document has no yaml section", async () => {
      const split = await splitMarkdown(appParsing([["heading", 0, 0]]), "# Alpha pilot\n");

      expect(split.frontmatter).toBeNull();
      expect(split.blocks).toEqual([{ type: "heading", text: "# Alpha pilot" }]);
    });

    it("classifies callout, math and list sections as text blocks", async () => {
      const source = "> [!note]\n> Hi\n\nAfter\n%%hidden%%\n\n$$\nx^2\n$$\n";
      const app = appParsing([
        ["callout", 0, 1],
        ["paragraph", 3, 4],
        ["math", 6, 8],
      ]);

      const split = await splitMarkdown(app, source);

      expect(split.blocks).toEqual([
        { type: "text", text: "> [!note]\n> Hi" },
        { type: "text", text: "After\n%%hidden%%" },
        { type: "text", text: "$$\nx^2\n$$" },
      ]);
    });

    it("keeps both lines of a setext heading in one heading block", async () => {
      const split = await splitMarkdown(appParsing([["heading", 0, 1]]), "Title\n---\n");

      expect(split.blocks).toEqual([{ type: "heading", text: "Title\n---" }]);
    });

    it("keeps inline triple backticks in a paragraph as text and splits the sections after it", async () => {
      const source = "```npm i``` installs deps.\n\n# Next\n\nMore text.\n";
      const app = appParsing([
        ["paragraph", 0, 0],
        ["heading", 2, 2],
        ["paragraph", 4, 4],
      ]);

      const split = await splitMarkdown(app, source);

      expect(split.blocks.map((block) => block.type)).toEqual(["text", "heading", "text"]);
    });

    it("classifies a list section holding a tab-indented fence as code so it is never word-diffed (https://github.com/Brevilabs/obsidian-copilot-private/issues/349)", async () => {
      const source = "- step\n\t```bash\n\tnpm run a\n\n\tnpm run b\n\t```\n";

      const split = await splitMarkdown(appParsing([["list", 0, 5]]), source);

      expect(split.blocks).toEqual([{ type: "code", text: source.trimEnd() }]);
    });

    it("keeps an unclosed frontmatter fence in the body because the parser reports no yaml section", async () => {
      const source = "---\ntags:\n  - project\n";
      const app = appParsing([
        ["thematicBreak", 0, 0],
        ["paragraph", 1, 1],
        ["list", 2, 2],
      ]);

      const split = await splitMarkdown(app, source);

      expect(split.frontmatter).toBeNull();
      expect(split.blocks).toEqual([
        { type: "text", text: "---" },
        { type: "text", text: "tags:" },
        { type: "text", text: "  - project" },
      ]);
    });

    it("returns the same frozen empty block list for every document without sections", async () => {
      const first = await splitMarkdown(appParsing([]), "");
      const second = await splitMarkdown(appParsing([]), "\n  \n");

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
