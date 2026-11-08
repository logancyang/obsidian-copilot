import { parseIntelligentUi, UI_LIMITS, UI_SCHEMA } from "@/intelligentUi/parser";
import { GOLDEN_EXAMPLES } from "@/intelligentUi/testing/golden";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/880";

describe("intelligentUi/parser", () => {
  describe("parseIntelligentUi()", () => {
    it(`accepts the epic's plain-text steps and layers icon (${ISSUE})`, () => {
      expect(
        parseIntelligentUi(
          '<grid columns="2"><card title="Router-first" icon="git-branch"><steps><step>User request</step><step>Select UI type</step><step>Generate answer</step></steps></card><card title="Composition-first" icon="layers"><steps><step>User request</step><step>Compose text and visuals</step></steps></card></grid>'
        ).status
      ).toBe("complete");
    });
    it(`rejects mixed step text and elements without reordering content (${ISSUE})`, () => {
      expect(
        parseIntelligentUi("<steps><step>Before<text>After</text></step></steps>")
      ).toMatchObject({ error: { code: "invalid-child" } });
      expect(
        parseIntelligentUi("<steps><step><text>Before</text>After</step></steps>")
      ).toMatchObject({ error: { code: "invalid-child" } });
    });
    it.each(Object.entries(GOLDEN_EXAMPLES))(
      `parses the %s golden example deterministically (${ISSUE})`,
      (_name, source) => {
        const result = parseIntelligentUi(source);
        expect(result.status).toBe("complete");
        expect(result).toEqual(parseIntelligentUi(source));
        expect(Object.isFrozen(result)).toBe(true);
        if (result.status !== "error") {
          expect(Object.isFrozen(result.nodes)).toBe(true);
          expect(Object.isFrozen(result.nodes[0])).toBe(true);
          expect(Object.isFrozen(result.nodes[0].props)).toBe(true);
          expect(Object.isFrozen(result.nodes[0].children)).toBe(true);
        }
      }
    );
    it.each(Object.entries(GOLDEN_EXAMPLES))(
      `keeps every character truncation of %s pending without errors (${ISSUE})`,
      (_name, source) => {
        for (let end = 0; end < source.length; end++) {
          expect(parseIntelligentUi(source.slice(0, end)).status).toBe(
            end === 0 ? "complete" : "pending"
          );
        }
      }
    );
    it(`declares every persisted primitive and accepts empty input (${ISSUE})`, () => {
      expect(Object.keys(UI_SCHEMA)).toEqual([
        "stack",
        "row",
        "grid",
        "card",
        "panel",
        "callout",
        "tabs",
        "tab",
        "divider",
        "heading",
        "text",
        "badge",
        "icon",
        "steps",
        "step",
        "metric",
        "markdown",
      ]);
      expect(parseIntelligentUi("")).toEqual({ status: "complete", nodes: [], pending: null });
    });
    it(`accepts toned callouts and titled tabs that contain elements (${ISSUE})`, () => {
      expect(
        parseIntelligentUi(
          '<callout tone="warning" title="Back up first"><text>Sync can overwrite notes.</text></callout><tabs><tab title="macOS"><text>Open Finder.</text></tab><tab title="Windows"><steps><step>Open Explorer.</step></steps></tab></tabs>'
        )
      ).toMatchObject({
        status: "complete",
        nodes: [
          { tag: "callout", props: { tone: "warning", title: "Back up first" } },
          {
            tag: "tabs",
            children: [{ props: { title: "macOS" } }, { props: { title: "Windows" } }],
          },
        ],
      });
    });
    it(`retains completed children inside unfinished containers (${ISSUE})`, () => {
      expect(parseIntelligentUi('<stack><text>Done</text><card title="Later')).toMatchObject({
        status: "pending",
        nodes: [
          {
            tag: "stack",
            complete: false,
            children: [{ tag: "text", text: "Done", complete: true }],
          },
        ],
        pending: { offset: 24 },
      });
    });
    it(`preserves Markdown links, literal ampersands and plain text (${ISSUE})`, () => {
      expect(
        parseIntelligentUi("<markdown>A & B [[Note]] [link](https://example.com)</markdown>")
      ).toMatchObject({ nodes: [{ text: "A & B [[Note]] [link](https://example.com)" }] });
    });
    it.each([
      ["<script/>", "unknown-tag"],
      ['<text onclick="x"/>', "unknown-prop"],
      ['<text style="x"/>', "unknown-prop"],
      ['<grid columns="4"/>', "invalid-prop"],
      ['<grid columns="1.5"/>', "invalid-prop"],
      ["<grid columns=0/>", "invalid-prop"],
      ["<card title=42/>", "invalid-prop"],
      ['<card icon="not-an-icon"/>', "invalid-prop"],
      ["<text></text extra>", "syntax"],
      ["</text>", "mismatched-close"],
      ["<divider>content</divider>", "invalid-child"],
      ['<icon name="unknown"/>', "invalid-prop"],
      ["<icon/>", "missing-prop"],
      ['<metric value="1"/>', "missing-prop"],
      ["<step/>", "invalid-parent"],
      ["<steps><text/></steps>", "invalid-parent"],
      ['<tab title="Alone"/>', "invalid-parent"],
      ["<tabs><text/></tabs>", "invalid-parent"],
      ['<tabs><step title="x"/></tabs>', "invalid-parent"],
      ["<tabs><tab/></tabs>", "missing-prop"],
      ['<callout tone="loud"/>', "invalid-prop"],
      ["<text><badge/></text>", "invalid-child"],
      ["<text>&amp;</text>", "forbidden-text"],
      ["<text>&#60;</text>", "forbidden-text"],
      ['<card title="&quot;"/>', "forbidden-text"],
      ['<card title="{x}"/>', "forbidden-text"],
      ["<grid columns={2}/>", "syntax"],
      ["<text>oops</card>", "mismatched-close"],
      ["<text/>outside", "invalid-child"],
      ['<text x="a" x="b"/>', "unknown-prop"],
      ['<card title="a" title="b"/>', "duplicate-prop"],
      ["<!-- hi -->", "syntax"],
      ["<!DOCTYPE x>", "syntax"],
      ['<text ="x"/>', "syntax"],
      ["<text/ rubbish>", "syntax"],
    ])(`rejects %s with %s and a source location (${ISSUE})`, (source, code) => {
      const result = parseIntelligentUi(source);
      expect(result).toMatchObject({
        status: "error",
        error: {
          code,
          offset: expect.any(Number) as number,
          line: expect.any(Number) as number,
          column: expect.any(Number) as number,
        },
      });
      expect(result).not.toHaveProperty("nodes");
    });
    it(`names the line and column of invalid markup (${ISSUE})`, () => {
      expect(parseIntelligentUi("\n<script/>")).toMatchObject({
        error: { offset: 1, line: 2, column: 1 },
      });
    });
    it(`accepts numeric columns, single quotes and whitespace (${ISSUE})`, () => {
      expect(parseIntelligentUi("<grid columns=3><card title='a > b'/></grid>")).toMatchObject({
        status: "complete",
        nodes: [{ props: { columns: 3 }, children: [{ props: { title: "a > b" } }] }],
      });
    });
    it(`enforces depth at the boundary (${ISSUE})`, () => {
      expect(
        parseIntelligentUi("<stack>".repeat(UI_LIMITS.depth) + "</stack>".repeat(UI_LIMITS.depth))
          .status
      ).toBe("complete");
      expect(parseIntelligentUi("<stack>".repeat(UI_LIMITS.depth + 1))).toMatchObject({
        error: { code: "depth-limit" },
      });
    });
    it(`enforces node count at the boundary (${ISSUE})`, () => {
      expect(parseIntelligentUi("<text/>".repeat(UI_LIMITS.nodes)).status).toBe("complete");
      expect(parseIntelligentUi("<text/>".repeat(UI_LIMITS.nodes + 1))).toMatchObject({
        error: { code: "node-limit" },
      });
    });
    it(`enforces total body and prop text at the boundary (${ISSUE})`, () => {
      expect(parseIntelligentUi("<text>" + "a".repeat(UI_LIMITS.text) + "</text>").status).toBe(
        "complete"
      );
      expect(
        parseIntelligentUi('<card title="a"><text>' + "a".repeat(UI_LIMITS.text) + "</text></card>")
      ).toMatchObject({ error: { code: "text-limit" } });
    });
    it(`bounds unfinished input before tokenization (${ISSUE})`, () => {
      expect(parseIntelligentUi(" ".repeat(UI_LIMITS.source)).status).toBe("complete");
      expect(parseIntelligentUi('<card title="' + "a".repeat(UI_LIMITS.source))).toMatchObject({
        error: { code: "source-limit" },
      });
    });
  });
});
