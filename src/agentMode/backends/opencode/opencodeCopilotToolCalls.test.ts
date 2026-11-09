import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";

const execute = (code: string) => ({ code });

const NOTION_CALL =
  'const res = await tools["obsidian-copilot"].notion_create_page({ title: "Orion" });\nreturn res;';
const TWO_CALLS =
  'const [a, b] = await Promise.all([\n  tools["obsidian-copilot"].notion_search({ query: "a" }),\n  tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };';

describe("opencodeCopilotToolCalls", () => {
  describe("readOpencodeCopilotTools()", () => {
    it("reads each Copilot tool call with the execute code from that call onward", () => {
      expect(
        readOpencodeCopilotTools(
          execute(
            'const a = 1;\nreturn tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });'
          )
        )
      ).toEqual({
        runs: "excalidraw_read",
        calls: [
          {
            name: "excalidraw_read",
            code: 'tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });',
          },
        ],
      });
    });

    it("lists every Copilot tool that code calls, in order", () => {
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
      ["a dotted", NOTION_CALL],
      [
        "a quoted",
        'const result = await tools["obsidian-copilot"]["notion_create_page"]({ title: "Orion" });\nreturn result;',
      ],
      [
        "a single-quoted namespace and dotted",
        "return tools['obsidian-copilot'].notion_create_page({ title: 'Orion' });",
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/872 says code runs the Copilot tool it calls once by %s member",
      (_shape, code) => {
        expect(readOpencodeCopilotTools(execute(code))?.runs).toBe("notion_create_page");
      }
    );

    it.each([
      ["code calling two Copilot tools", TWO_CALLS],
      [
        "code calling a Copilot tool and another namespace's tool",
        'await tools.opencode.list_mcp_resources({});\nreturn tools["obsidian-copilot"].notion_search({ query: "a" });',
      ],
      [
        "code that calls one Copilot tool directly and another through a destructured alias",
        'const { "obsidian-copilot": copilot } = tools;\nawait tools["obsidian-copilot"].notion_search({ query: "a" });\nreturn copilot.notion_create_page({ title: "b" });',
      ],
      [
        "code that fetches a URL beside one Copilot tool call",
        'const page = await fetch("https://example.com");\nreturn tools["obsidian-copilot"].notion_search({ query: await page.text() });',
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/872 names no tool the call runs for %s, since its approval may cover more than one tool",
      (_name, code) => {
        expect(readOpencodeCopilotTools(execute(code))?.runs).toBeNull();
      }
    );

    it.each([
      ["code that only mentions a tool", execute("// excalidraw_write")],
      [
        "code that only searches the catalog",
        execute('const r = search({ query: "notion" });\nreturn r;'),
      ],
      [
        "code calling another namespace's tool",
        execute("return await tools.opencode.list_mcp_resources({});"),
      ],
      [
        "code that reaches Copilot's tools only through an alias",
        execute(
          'const copilot = tools["obsidian-copilot"];\nreturn copilot.notion_search({ query: "a" });'
        ),
      ],
      ["a call without code", undefined],
    ])("returns null for %s", (_name, input) => {
      expect(readOpencodeCopilotTools(input)).toBeNull();
    });
  });
});
