import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";

const output = (toolCalls: unknown) => ({ metadata: { toolCalls } });

describe("opencodeCopilotToolCalls", () => {
  describe("readOpencodeCopilotTools()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 reads the executed tool name and concrete input from OpenCode metadata", () => {
      expect(
        readOpencodeCopilotTools(
          undefined,
          output([
            {
              tool: "obsidian-copilot.everything_echo",
              status: "completed",
              input: { message: "MCP tools test" },
            },
          ])
        )
      ).toEqual({
        wrapper: "Execute",
        label: "obsidian-copilot · Everything echo",
        calls: [{ name: "everything_echo", args: { message: "MCP tools test" } }],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 preserves actual call order, repeated calls and failed attempts including other namespaces", () => {
      expect(
        readOpencodeCopilotTools(
          undefined,
          output([
            {
              tool: "obsidian-copilot.everything_echo",
              status: "completed",
              input: { message: "alpha" },
            },
            { tool: "fetch", status: "completed", input: { url: "https://example.com" } },
            { tool: "other.echo", status: "completed" },
            {
              tool: "obsidian-copilot.everything_echo",
              status: "completed",
              input: { message: "beta" },
            },
            { tool: "obsidian-copilot.everything_get-sum", status: "error", input: { a: 2, b: 3 } },
          ])
        )
      ).toEqual({
        wrapper: "Execute",
        label:
          "obsidian-copilot · Everything echo, OpenCode · Fetch, other · Echo, obsidian-copilot · Everything get sum",
        calls: [
          { name: "everything_echo", args: { message: "alpha" } },
          { name: "everything_echo", args: { message: "beta" } },
          { name: "everything_get-sum", args: { a: 2, b: 3 } },
        ],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 names resource discovery and search even without a Copilot call", () => {
      expect(
        readOpencodeCopilotTools(
          undefined,
          output([
            { tool: "opencode.list_mcp_resources", input: { server: "notes" } },
            { tool: "search", input: { query: "connectors" } },
            { tool: "notes.search", input: { query: "meeting" } },
          ])
        )
      ).toEqual({
        wrapper: "Execute",
        label: "OpenCode · List mcp resources, OpenCode · Search, notes · Search",
        calls: [],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 excludes foreign feature-name collisions from canonical calls while retaining their display names", () => {
      expect(
        readOpencodeCopilotTools(
          undefined,
          output([
            { tool: "other.excalidraw_write", input: { path: "foreign.md" } },
            { tool: "obsidian-copilot.notion_search", input: { query: "Orion" } },
            { tool: "opencode.search" },
          ])
        )
      ).toEqual({
        wrapper: "Execute",
        calls: [{ name: "notion_search", args: { query: "Orion" } }],
        label: "other · Excalidraw write, Notion · Search, OpenCode · Search",
      });
    });

    it.each([
      'const echo = tools["obsidian-copilot"].everything_echo; return echo({ message: "hello" });',
      'const name = "everything_echo"; return tools["obsidian-copilot"][name]({ message: "hello" });',
      '// tools["obsidian-copilot"].notion_create_page({})\nreturn "tools fetch";',
      "not valid JavaScript at all",
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 uses runtime metadata independently of execute source: %s",
      (code) => {
        const result = readOpencodeCopilotTools(
          { code },
          output([
            {
              tool: "obsidian-copilot.everything_echo",
              status: "completed",
              input: { message: "hello" },
            },
          ])
        );
        expect(result).toEqual({
          wrapper: "Execute",
          label: "obsidian-copilot · Everything echo",
          calls: [{ name: "everything_echo", args: { message: "hello" } }],
        });
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 supplies empty arguments when OpenCode omits an empty input", () => {
      expect(
        readOpencodeCopilotTools(
          undefined,
          output([
            { tool: "obsidian-copilot.everything_toggle-simulated-logging", status: "completed" },
          ])
        )?.calls
      ).toEqual([{ name: "everything_toggle-simulated-logging", args: {} }]);
    });

    it.each([
      undefined,
      {},
      { metadata: {} },
      output(null),
      output("not a list"),
      output([]),
      output([null, {}, { tool: 42 }, { tool: "obsidian-copilot." }]),
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/875 returns no recognized calls for absent or unusable execution metadata: %j",
      (rawOutput) => {
        expect(
          readOpencodeCopilotTools(
            { code: 'return tools["obsidian-copilot"].everything_echo({});' },
            rawOutput
          )
        ).toBeNull();
      }
    );
  });
});
