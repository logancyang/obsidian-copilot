import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";

const execute = (code: string) => ({ code });
const NOTION_CALL =
  'const res = await tools["obsidian-copilot"].notion_create_page({ title: "Orion" });\nreturn res;';
const TWO_CALLS =
  'const [a, b] = await Promise.all([\n  tools["obsidian-copilot"].notion_search({ query: "a" }),\n  tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };';

describe("opencodeCopilotToolCalls", () => {
  describe("readOpencodeCopilotTools()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 keeps the execute wrapper and reads the original source from each recognized call onward", () => {
      expect(
        readOpencodeCopilotTools(
          execute(
            'const a = 1;\nreturn tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });'
          )
        )
      ).toEqual({
        wrapper: "Execute",
        calls: [
          {
            name: "excalidraw_read",
            code: 'tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });',
          },
        ],
      });
    });

    it("lists every Copilot tool that code calls, in source order", () => {
      expect(readOpencodeCopilotTools(execute(TWO_CALLS))?.calls).toEqual([
        {
          name: "notion_search",
          code: 'tools["obsidian-copilot"].notion_search({ query: "a" }),\n  tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };',
        },
        {
          name: "notion_create_page",
          code: 'tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };',
        },
      ]);
    });

    it.each([
      ["a dotted member", NOTION_CALL],
      ["a quoted member", 'return tools["obsidian-copilot"]["notion_create_page"]({});'],
      ["single quotes", "return tools['obsidian-copilot'].notion_create_page({});"],
      [
        "whitespace between members",
        'return tools [ "obsidian-copilot" ] . notion_create_page ({});',
      ],
      [
        "comments between members",
        'return tools /* tools */ [ "obsidian-copilot" ] /* fetch */ . notion_create_page ({});',
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 recognizes a direct tool call with %s",
      (_case, code) => {
        const result = readOpencodeCopilotTools(execute(code));
        expect(result?.wrapper).toBe("Execute");
        expect(result?.calls.map((call) => call.name)).toEqual(["notion_create_page"]);
      }
    );

    it.each([
      [
        "argument strings",
        'return tools["obsidian-copilot"].notion_search({ query: "tools fetch" });',
      ],
      [
        "comments",
        '/* tools fetch */\nreturn tools["obsidian-copilot"].notion_search({}); // fetch tools',
      ],
      [
        "template text",
        'return tools["obsidian-copilot"].notion_search({ query: `tools fetch` });',
      ],
      [
        "regular expressions",
        'const pattern = /tools|fetch/g; return tools["obsidian-copilot"].notion_search({ query: pattern.source });',
      ],
      [
        "ordinary object keys",
        'return tools["obsidian-copilot"].notion_search({ tools: "notes", fetch: "all" });',
      ],
      [
        "an actual fetch",
        'await fetch("https://example.com"); return tools["obsidian-copilot"].notion_search({});',
      ],
      [
        "another aliased operation",
        'const { "obsidian-copilot": copilot } = tools; await tools["obsidian-copilot"].notion_search({}); return copilot.notion_create_page({});',
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 lists the recognized tool and keeps Execute regardless of %s",
      (_case, code) => {
        const result = readOpencodeCopilotTools(execute(code));
        expect(result?.wrapper).toBe("Execute");
        expect(result?.calls.map((call) => call.name)).toEqual(["notion_search"]);
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 ignores tool-call examples inside strings and comments", () => {
      const result = readOpencodeCopilotTools(
        execute(`
        const example = 'tools["obsidian-copilot"].notion_create_page({})';
        // tools["obsidian-copilot"].notion_delete_page({})
        return tools["obsidian-copilot"].notion_search({ query: example });
      `)
      );
      expect(result?.calls.map((call) => call.name)).toEqual(["notion_search"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 recognizes real tool calls inside template substitutions", () => {
      const code = 'return `Result: ${await tools["obsidian-copilot"].notion_search({})}`;';
      expect(readOpencodeCopilotTools(execute(code))?.calls.map((call) => call.name)).toEqual([
        "notion_search",
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 retains source order for nested calls", () => {
      const result = readOpencodeCopilotTools(
        execute(
          'return tools["obsidian-copilot"].notion_create_page({ title: await tools["obsidian-copilot"].notion_search({}) });'
        )
      );
      expect(result?.calls.map((call) => call.name)).toEqual([
        "notion_create_page",
        "notion_search",
      ]);
    });

    it.each([
      ["a call without code", undefined],
      ["a catalog search", execute('return search({query:"notion"});')],
      ["another namespace", execute("return tools.other.notion_search({});")],
      [
        "an alias-only call",
        execute('const copilot = tools["obsidian-copilot"]; return copilot.notion_search({});'),
      ],
      [
        "a different object's tools property",
        execute('return other.tools["obsidian-copilot"].notion_search({});'),
      ],
      [
        "an optional tools property",
        execute('return other?.tools["obsidian-copilot"].notion_search({});'),
      ],
      ["a quoted example", execute("return 'tools[\"obsidian-copilot\"].notion_search({})';")],
      ["a template example", execute('return `tools["obsidian-copilot"].notion_search({})`;')],
      ["a comment example", execute('// tools["obsidian-copilot"].notion_search({})')],
      [
        "an unclosed string",
        execute('return tools["obsidian-copilot"].notion_search({query:"unfinished'),
      ],
      ["an invalid token", execute('@ tools["obsidian-copilot"].notion_search({});')],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 returns no recognized calls for %s",
      (_case, input) => {
        expect(readOpencodeCopilotTools(input)).toBeNull();
      }
    );
  });
});
