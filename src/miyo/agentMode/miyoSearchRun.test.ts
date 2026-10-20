import type { AgentMessagePart } from "@/agentMode/session/types";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { miyoResultPaths, miyoSearchRun } from "@/miyo/agentMode/miyoSearchRun";

function tool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "x",
    title: "tool",
    status: "completed",
    ...overrides,
  };
}

describe("miyoSearchRun", () => {
  describe("miyoSearchRun()", () => {
    const miyoJson = (paths: string[]) =>
      JSON.stringify({
        results: paths.map((path) => ({ path, content: "…" })),
        count: paths.length,
      });
    const stdout = (text: string): Pick<ToolCallPart, "output"> => ({
      output: [{ type: "text", text }],
    });
    const NOTES = ["step-1/notes/Trip planning.md", "step-1/notes/Sourdough starter.md"];
    const DOWN =
      "Miyo search failed. Continue with keyword search. Details: net::ERR_CONNECTION_REFUSED";
    const claudeCall = (overrides: Partial<ToolCallPart> = {}) =>
      tool({
        title: "miyo_search",
        toolKind: "other",
        mcpServer: "obsidian-copilot",
        vendorToolName: "miyo_search",
        input: { query: "hiking trip", variants: ["hike"] },
        ...overrides,
      });
    const codexCall = (overrides: Partial<ToolCallPart> = {}) =>
      tool({
        title: "mcp.obsidian-copilot.miyo_search",
        toolKind: "execute",
        input: {
          server: "obsidian-copilot",
          tool: "miyo_search",
          arguments: { query: "hiking trip", variants: ["hike"] },
        },
        ...overrides,
      });
    const opencodeCall = (overrides: Partial<ToolCallPart> = {}) =>
      tool({
        title: "execute",
        toolKind: "other",
        input: {
          code: 'const r = await tools["obsidian-copilot"].miyo_search({ query: "hiking trip", variants: ["hike"] });\nreturn r;',
        },
        ...overrides,
      });
    const backends = [
      ["Claude", claudeCall],
      ["Codex", codexCall],
      ["OpenCode", opencodeCall],
    ] as const;

    it.each(backends)(
      "reads the query, the note count and the note paths from a completed %s miyo_search call (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)",
      (_name, call) => {
        expect(miyoSearchRun(call(stdout(miyoJson(NOTES))))).toEqual({
          status: "completed",
          query: "hiking trip",
          noteCount: 2,
          notePaths: NOTES,
          error: null,
        });
      }
    );

    it("reads the notes from the pretty-printed JSON OpenCode returns", () => {
      const t = opencodeCall(
        stdout(JSON.stringify({ results: [{ path: "a.md" }], count: 1 }, null, 2))
      );
      expect(miyoSearchRun(t)).toMatchObject({ noteCount: 1, notePaths: ["a.md"] });
    });

    it.each(backends)(
      "shows a %s call with no result yet as running with its query and no count",
      (_name, call) => {
        expect(miyoSearchRun(call({ status: "in_progress" }))).toEqual({
          status: "in_progress",
          query: "hiking trip",
          noteCount: null,
          notePaths: [],
          error: null,
        });
      }
    );

    it.each(backends)(
      "reports no notes for a completed %s call whose search matched nothing",
      (_name, call) => {
        expect(miyoSearchRun(call(stdout(miyoJson([]))))).toMatchObject({
          noteCount: 0,
          notePaths: [],
        });
      }
    );

    it("counts each note once when a result lists it more than once", () => {
      const t = claudeCall(stdout(miyoJson(["a.md", "a.md", "b.md"])));
      expect(miyoSearchRun(t)?.noteCount).toBe(2);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 counts notes from other Miyo folders but offers only the vault's notes for link badges", () => {
      const text = JSON.stringify({
        results: [
          { path: "Research/Sleep.md" },
          { folder: "Research", path: "Interview.md" },
          { folder: "Reading Notes", path: "Research/Sleep.md" },
        ],
        count: 3,
      });
      expect(miyoSearchRun(claudeCall(stdout(text)))).toMatchObject({
        noteCount: 3,
        notePaths: ["Research/Sleep.md"],
      });
    });

    it.each(backends)(
      "reports a failed %s call with the error text the tool returned",
      (_name, call) => {
        expect(miyoSearchRun(call({ status: "failed", ...stdout(DOWN) }))).toEqual({
          status: "failed",
          query: "hiking trip",
          noteCount: null,
          notePaths: [],
          error: "net::ERR_CONNECTION_REFUSED",
        });
      }
    );

    it("reports the whole failure text when it has no Details part (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
      const text = "query must be a non-empty string.";
      expect(miyoSearchRun(claudeCall({ status: "failed", ...stdout(text) }))?.error).toBe(text);
    });

    it("reports a failed call without output as failed with no error text", () => {
      expect(miyoSearchRun(codexCall({ status: "failed" }))).toMatchObject({
        status: "failed",
        error: null,
      });
    });

    it("keeps an OpenCode call completed when its code returned something other than the raw result list (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
      const t = opencodeCall(stdout(JSON.stringify({ len: 1200, count: 3 }, null, 2)));
      expect(miyoSearchRun(t)).toEqual({
        status: "completed",
        query: "hiking trip",
        noteCount: null,
        notePaths: [],
        error: null,
      });
    });

    it("reports a completed call with no output as completed with an unknown count", () => {
      expect(miyoSearchRun(codexCall())).toMatchObject({
        status: "completed",
        noteCount: null,
        error: null,
      });
    });

    it.each([
      ["a Claude call without a query", claudeCall({ input: {} })],
      [
        "a Codex call without arguments",
        codexCall({ input: { server: "obsidian-copilot", tool: "miyo_search" } }),
      ],
      [
        "an OpenCode call whose query is not a string literal",
        opencodeCall({
          input: { code: 'return tools["obsidian-copilot"].miyo_search({ query: q });' },
        }),
      ],
    ])("shows the card without a query for %s", (_name, call) => {
      expect(miyoSearchRun(call)?.query).toBeNull();
    });

    it("reads an OpenCode query written with escapes and single-quoted tool access", () => {
      const t = opencodeCall({
        input: {
          code: 'return tools[\'obsidian-copilot\'].miyo_search({ "query": "say \\"hi\\"" });',
        },
      });
      expect(miyoSearchRun(t)?.query).toBe('say "hi"');
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 reads an OpenCode query written as a single-quoted literal", () => {
      const t = opencodeCall({
        input: {
          code: `return tools["obsidian-copilot"].miyo_search({ query: 'Sam\\'s "standing" desk' });`,
        },
      });
      expect(miyoSearchRun(t)?.query).toBe('Sam\'s "standing" desk');
    });

    it.each([
      ["a miyo_search tool on another MCP server", claudeCall({ mcpServer: "other" })],
      ["another tool on the Copilot server", claudeCall({ vendorToolName: "send_feedback" })],
      [
        "a Codex call to another tool",
        codexCall({ input: { server: "obsidian-copilot", tool: "send_feedback", arguments: {} } }),
      ],
      [
        "an OpenCode execute call to another tool",
        opencodeCall({ input: { code: 'return tools["obsidian-copilot"].send_feedback({});' } }),
      ],
      [
        "an OpenCode execute call that only mentions the tool",
        opencodeCall({ input: { code: "// miyo_search" } }),
      ],
      ["a call without input", tool({ input: undefined })],
    ])("returns null for %s", (_name, call) => {
      expect(miyoSearchRun(call)).toBeNull();
    });

    it.each([
      [
        "a shell run of the miyo-search script",
        tool({
          vendorToolName: "Bash",
          input: { command: 'sh ".claude/skills/miyo-search/miyo-search.sh" "desk"' },
          ...stdout(miyoJson(["a.md"])),
        }),
      ],
      [
        "a direct miyo CLI search",
        tool({ toolKind: "execute", input: { command: 'miyo search --json "desk"' } }),
      ],
      [
        "a load of the miyo-search skill",
        tool({ vendorToolName: "Skill", input: { skill: "miyo-search" } }),
      ],
    ])(
      "returns null for %s saved by an earlier Copilot version so it renders as an ordinary row (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)",
      (_name, call) => {
        expect(miyoSearchRun(call)).toBeNull();
      }
    );
  });

  describe("miyoResultPaths()", () => {
    const search = (call: Partial<ToolCallPart>, paths: string[]) =>
      tool({
        mcpServer: "obsidian-copilot",
        vendorToolName: "miyo_search",
        input: { query: "q" },
        output: [
          { type: "text", text: JSON.stringify({ results: paths.map((path) => ({ path })) }) },
        ],
        ...call,
      });

    it("collects each note path once across every miyo_search call in the turn", () => {
      const parts: AgentMessagePart[] = [
        search({}, ["v/notes/A.md", "v/notes/B.md"]),
        { kind: "text", text: "Checking more." },
        search({}, ["v/notes/B.md", "v/notes/C.md"]),
      ];
      expect([...new Set(miyoResultPaths(parts))]).toEqual([
        "v/notes/A.md",
        "v/notes/B.md",
        "v/notes/C.md",
      ]);
    });

    it("collects the notes of Claude, Codex and OpenCode calls alike", () => {
      const parts: AgentMessagePart[] = [
        search({}, ["v/claude.md"]),
        search(
          {
            mcpServer: undefined,
            vendorToolName: undefined,
            input: { server: "obsidian-copilot", tool: "miyo_search", arguments: { query: "q" } },
          },
          ["v/codex.md"]
        ),
        search(
          {
            mcpServer: undefined,
            vendorToolName: undefined,
            input: { code: 'return tools["obsidian-copilot"].miyo_search({ query: "q" });' },
          },
          ["v/opencode.md"]
        ),
      ];
      expect(miyoResultPaths(parts)).toEqual(["v/claude.md", "v/codex.md", "v/opencode.md"]);
    });

    it("ignores other tool calls, failed searches and searches with no readable output", () => {
      const parts: AgentMessagePart[] = [
        tool({ vendorToolName: "Grep", input: { pattern: "desk" } }),
        search({ status: "failed", output: [{ type: "text", text: "Miyo search failed." }] }, []),
        search({ output: undefined }, []),
        { kind: "text", text: "Nothing found." },
      ];
      expect(miyoResultPaths(parts)).toEqual([]);
    });
  });
});
