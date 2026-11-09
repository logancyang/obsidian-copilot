import { opencodeCopilotToolCalls } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";
import type { AgentMessagePart } from "@/agentMode/session/types";

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

function execute(code: string): ToolCallPart {
  return {
    kind: "tool_call",
    id: "opencode",
    title: "execute",
    status: "completed",
    toolKind: "other",
    input: { code },
  };
}

const NOTION_CALL =
  'const res = await tools["obsidian-copilot"].notion_create_page({ title: "Orion" });\nreturn res;';
const TWO_CALLS =
  'const [a, b] = await Promise.all([\n  tools["obsidian-copilot"].notion_search({ query: "a" }),\n  tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };';

describe("opencodeCopilotToolCalls", () => {
  describe("call()", () => {
    it("returns the execute code from the named tool's call onward", () => {
      const part = execute(
        'const a = 1;\nreturn tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });'
      );
      expect(opencodeCopilotToolCalls.call(part, "excalidraw_read")).toEqual({
        code: 'tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });',
      });
    });

    it("finds the named tool in code that calls several Copilot tools", () => {
      expect(opencodeCopilotToolCalls.call(execute(TWO_CALLS), "notion_create_page")).toEqual({
        code: 'tools["obsidian-copilot"].notion_create_page({ title: "b" }),\n]);\nreturn { a, b };',
      });
    });

    it.each([
      ["code that only mentions the tool", execute("// excalidraw_write")],
      [
        "code calling another Copilot tool",
        execute('return tools["obsidian-copilot"].excalidraw_render({});'),
      ],
      ["a call without code", { ...execute(""), input: undefined }],
    ])("returns null for %s", (_name, part) => {
      expect(opencodeCopilotToolCalls.call(part, "excalidraw_write")).toBeNull();
    });
  });

  describe("toolName()", () => {
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
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/872 names the Copilot tool that execute code calls once by %s member",
      (_shape, code) => {
        expect(opencodeCopilotToolCalls.toolName(execute(code))).toBe("notion_create_page");
      }
    );

    it.each([
      ["code calling two Copilot tools", TWO_CALLS],
      [
        "code calling a Copilot tool and another namespace's tool",
        'await tools.opencode.list_mcp_resources({});\nreturn tools["obsidian-copilot"].notion_search({ query: "a" });',
      ],
      ["code that only searches the catalog", 'const r = search({ query: "notion" });\nreturn r;'],
      [
        "code calling another namespace's tool",
        "return await tools.opencode.list_mcp_resources({});",
      ],
      [
        "code that reaches Copilot's tools through an alias",
        'const copilot = tools["obsidian-copilot"];\nreturn copilot.notion_search({ query: "a" });',
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
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/872 returns null for %s, since its approval may cover more than one tool",
      (_name, code) => {
        expect(opencodeCopilotToolCalls.toolName(execute(code))).toBeNull();
      }
    );
  });
});
