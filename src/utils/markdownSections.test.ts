import {
  extraBlankLinesBetween,
  parseMarkdownSections,
  withBlankLineBreaks,
  type MarkdownSection,
} from "@/utils/markdownSections";
import type { App } from "obsidian";

type SectionSpan = readonly [type: string, startLine: number, endLine: number];

function sectionOf(lines: readonly string[], [type, startLine, endLine]: SectionSpan) {
  const source = lines.join("\n");
  const offsetOf = (line: number, column: number): number =>
    Math.min(
      lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0) + column,
      source.length
    );
  return {
    type,
    position: {
      start: { line: startLine, offset: offsetOf(startLine, 0) },
      end: { line: endLine, offset: offsetOf(endLine, (lines[endLine] ?? "").length) },
    },
  };
}

function appParsing(spans: readonly SectionSpan[], listItems?: unknown[]): App {
  const computeMetadataAsync = jest.fn(async (buffer: ArrayBuffer) => {
    const lines = new TextDecoder().decode(buffer).split("\n");
    return { sections: spans.map((span) => sectionOf(lines, span)), listItems };
  });
  return { metadataCache: { computeMetadataAsync } } as unknown as App;
}

function section(startLine: number, endLine: number): MarkdownSection {
  return {
    type: "paragraph",
    position: { start: { line: startLine, offset: 0 }, end: { line: endLine, offset: 0 } },
  };
}

describe("markdownSections", () => {
  describe("parseMarkdownSections()", () => {
    it("returns the sections and list items Obsidian parses from the exact source text", async () => {
      const listItems = [{ parent: -2, position: { start: { line: 2 } } }];
      const app = appParsing(
        [
          ["paragraph", 0, 0],
          ["list", 2, 2],
        ],
        listItems
      );

      const parsed = await parseMarkdownSections(app, "Héllo\n\n- one");

      const parser = app.metadataCache as unknown as {
        computeMetadataAsync: jest.Mock<Promise<unknown>, [ArrayBuffer]>;
      };
      const [buffer] = parser.computeMetadataAsync.mock.calls[0];
      expect(new TextDecoder().decode(buffer)).toBe("Héllo\n\n- one");
      expect(parsed.sections.map(({ type, position }) => [type, position.start.line])).toEqual([
        ["paragraph", 0],
        ["list", 2],
      ]);
      expect(parsed.listItems).toEqual(listItems);
    });

    it("drops the empty sections Obsidian appends past a note that ends in a footnote definition (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const app = appParsing([
        ["paragraph", 0, 0],
        ["footnoteDefinition", 2, 2],
        ["text", 3, 3],
      ]);

      const parsed = await parseMarkdownSections(app, "Body[^1]\n\n[^1]: Footnote text.");

      expect(parsed.sections.map(({ type }) => type)).toEqual(["paragraph", "footnoteDefinition"]);
    });

    it("returns one shared frozen empty list when the parse reports no list items", async () => {
      const first = await parseMarkdownSections(appParsing([["paragraph", 0, 0]]), "Alpha");
      const second = await parseMarkdownSections(appParsing([["paragraph", 0, 0]]), "Beta");

      expect(first.listItems).toEqual([]);
      expect(second.listItems).toBe(first.listItems);
      expect(Object.isFrozen(first.listItems)).toBe(true);
    });

    it("rejects when Obsidian does not expose computeMetadataAsync so each caller can pick its fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/348)", async () => {
      const app = { metadataCache: {} } as unknown as App;

      await expect(parseMarkdownSections(app, "# Alpha pilot\n")).rejects.toThrow(
        "Obsidian's Markdown parser is unavailable"
      );
    });
  });

  describe("extraBlankLinesBetween()", () => {
    it("counts the blank lines between two sections beyond the first one", () => {
      expect(extraBlankLinesBetween(section(0, 1), section(5, 5))).toBe(2);
    });

    it("returns zero for sections that are adjacent or separated by a single blank line", () => {
      expect(extraBlankLinesBetween(section(0, 0), section(1, 1))).toBe(0);
      expect(extraBlankLinesBetween(section(0, 0), section(2, 2))).toBe(0);
    });
  });

  describe("withBlankLineBreaks()", () => {
    it("turns each blank line past the first between sections into a <br> line, as Live Preview shows them (https://github.com/Brevilabs/obsidian-copilot-private/issues/751)", async () => {
      const app = appParsing([
        ["paragraph", 0, 0],
        ["paragraph", 4, 5],
        ["paragraph", 7, 7],
      ]);

      const markdown = await withBlankLineBreaks(app, "Alpha\n\n\n\nBeta\nline two\n\nGamma");

      expect(markdown).toBe("Alpha\n\n<br>\n<br>\n\nBeta\nline two\n\nGamma");
    });

    it("leaves blank lines inside a fenced code block as written", async () => {
      const app = appParsing([
        ["code", 0, 5],
        ["paragraph", 8, 8],
      ]);

      const markdown = await withBlankLineBreaks(app, "```\na\n\n\nb\n```\n\n\nAfter\n");

      expect(markdown).toBe("```\na\n\n\nb\n```\n\n<br>\n\nAfter\n");
    });

    it("returns the text unchanged when no two sections are more than one blank line apart", async () => {
      const app = appParsing([
        ["heading", 0, 0],
        ["paragraph", 2, 2],
      ]);

      expect(await withBlankLineBreaks(app, "# Alpha\n\nBody\n\n\n")).toBe("# Alpha\n\nBody\n\n\n");
    });
  });
});
