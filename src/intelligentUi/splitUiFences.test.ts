import { splitUiFences } from "@/intelligentUi/splitUiFences";
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/883";

describe("splitUiFences", () => {
  describe("splitUiFences()", () => {
    it("keeps surrounding prose and multiple layout blocks in source order", () => {
      expect(
        splitUiFences(
          "Before\n```copilot-ui\n<text>A</text>\n```\nBetween\n~~~copilot-ui\n<text>B</text>\n~~~\nAfter",
          false
        ).map(({ kind, source }) => [kind, source])
      ).toEqual([
        ["markdown", "Before\n"],
        ["layout", "<text>A</text>\n"],
        ["markdown", "Between\n"],
        ["layout", "<text>B</text>\n"],
        ["markdown", "After"],
      ]);
    });
    it.each([
      "```text\n```copilot-ui\n<text>literal</text>\n```",
      "````\n```copilot-ui\n<text>literal</text>\n```\n````",
      "    ```copilot-ui\n<text>literal</text>",
      "```copilot-ui extra\n<text>literal</text>\n```",
    ])(
      `leaves ordinary code and indented or unrelated fences unchanged (${ISSUE}): %s`,
      (source) => {
        expect(splitUiFences(source, true)).toEqual([
          { kind: "markdown", source, offset: 0, closed: true },
        ]);
      }
    );
    it.each(["`", "``", "```", "~", "~~", "~~~"])(
      `withholds a streamed closing fence without losing final source (${ISSUE}): %s`,
      (tail) => {
        const marker = tail[0].repeat(3);
        const source = `${marker}copilot-ui\n<text>Done</text>\n${tail}`;
        expect(splitUiFences(source, true)[0].source.trim()).toBe("<text>Done</text>");
        if (tail.length < 3) expect(splitUiFences(source, false)[0].source).toContain(tail);
      }
    );
    it.each([1, 2, 3])(
      `removes opening indentation from closed and unfinished bodies as native Markdown does (${ISSUE}): %s`,
      (indent) => {
        const pad = " ".repeat(indent);
        const body = `${pad}<markdown>\n${pad}  [[Research]]\n${pad}</markdown>\n`;
        for (const closing of ["", `${pad}\`\`\``]) {
          expect(splitUiFences(`${pad}\`\`\`copilot-ui\n${body}${closing}`, true)[0].source).toBe(
            "<markdown>\n  [[Research]]\n</markdown>\n"
          );
        }
      }
    );
    it.each(["-", "+", "*", "1.", "2)"])(
      `keeps a literal layout fence inside ordinary list code unchanged (${ISSUE}): %s`,
      (marker) => {
        const pad = " ".repeat(marker.length + 1);
        const source = `${marker} \`\`\`\`text\n${pad}\`\`\`copilot-ui\n${pad}<text>literal</text>\n${pad}\`\`\`\n${pad}\`\`\`\``;
        expect(splitUiFences(source, true)).toEqual([
          { kind: "markdown", source, offset: 0, closed: true },
        ]);
      }
    );
    it(`keeps an unfinished attribute and reports an open fence (${ISSUE})`, () => {
      expect(splitUiFences('```copilot-ui\n<card title="partial', true)[0]).toEqual({
        kind: "layout",
        source: '<card title="partial',
        offset: 0,
        closed: false,
      });
    });
  });
});
