import {
  displayTargetFromPath,
  lookupToolSummary,
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
  miyoResultPaths,
  miyoSearchRun,
} from "@/agentMode/ui/toolSummaries";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";

const CTX = { vaultBase: "/Users/me/vault" };

function tool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "x",
    title: "tool",
    status: "completed",
    ...overrides,
  };
}

describe("toolSummaries", () => {
  describe("lookupToolSummary()", () => {
    it("uses Read entry when vendorToolName is Read", () => {
      const t = tool({
        vendorToolName: "Read",
        title: "read music-theory.md",
        output: [{ type: "text", text: "hello world".repeat(100) }],
      });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX)).toMatch(/^Read /);
      expect(s.outcome(t)).toMatch(/tokens$/);
    });

    it("renders Read paths relative to the vault root", () => {
      const t = tool({
        vendorToolName: "Read",
        title: "read",
        locations: [{ path: "/Users/me/vault/notes/music-theory.md" }],
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Read notes/music-theory.md");
    });

    it("hides parent directories outside the vault without changing the navigation target", () => {
      const t = tool({
        vendorToolName: "Read",
        title: "read",
        locations: [{ path: "/etc/passwd" }],
      });
      const summary = lookupToolSummary(t);
      expect(summary.collapsedLine(t, CTX)).toBe("Read …/passwd");
      expect(summary.targetPath?.(t, CTX)).toBe("/etc/passwd");
    });

    it("hides parent directories for ACP read paths without vault context", () => {
      const t = tool({
        toolKind: "read",
        title: "Read",
        input: { filePath: "/Users/me/private/draft.md" },
      });
      expect(lookupToolSummary(t).collapsedLine(t, { vaultBase: null })).toBe("Read …/draft.md");
      const windows = { ...t, input: { filePath: "C:\\Users\\me\\private\\draft.md" } };
      expect(lookupToolSummary(windows).collapsedLine(windows, CTX)).toBe("Read …/draft.md");
    });

    it("recognizes opencode task tool by data shape", () => {
      const t = tool({
        title: "find jazz voicings",
        toolKind: "other",
        input: {
          subagent_type: "research-agent",
          description: "find jazz voicings",
          prompt: "...",
        },
      });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX)).toBe('research-agent · "find jazz voicings"');
    });

    it('routes Claude Code\'s "Agent" vendor name to the sub-agent summary', () => {
      const t = tool({
        vendorToolName: "Agent",
        toolKind: "think",
        title: "Map user-facing features",
        input: {
          subagent_type: "Explore",
          description: "Map user-facing features of obsidian-copilot",
          prompt: "Explore the codebase…",
        },
      });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX)).toBe(
        'Explore · "Map user-facing features of obsidian-copilot"'
      );
      const taskEquiv = lookupToolSummary({ ...t, vendorToolName: "Task" });
      expect(s).toBe(taskEquiv);
    });

    it("maps the LS tool onto the list summary", () => {
      const list = tool({
        vendorToolName: "LS",
        toolKind: "read",
        title: "LS Daily",
        input: { path: "Daily" },
      });
      expect(lookupToolSummary(list).collapsedLine(list, CTX)).toBe("Listed Daily");
    });

    it("falls back to ACP toolKind when vendor is missing", () => {
      const t = tool({ toolKind: "edit", title: "wrote thing" });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX)).toBe("Edited files");
    });

    it("falls back to generic when both vendor and toolKind are unknown", () => {
      const t = tool({ title: "weirdtool" });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX)).toBe("Weirdtool");
    });

    it("humanizes a generic tool name instead of rendering '…'", () => {
      const t = tool({ vendorToolName: "do_thing", title: "do_thing" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Do thing");
    });

    it("renders an MCP tool as 'server · Tool name'", () => {
      const t = tool({
        vendorToolName: "query-docs",
        title: "query-docs",
        mcpServer: "context7",
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("context7 · Query docs");
    });

    it("keeps the 'server ·' prefix when an MCP tool's bare name collides with a native tool", () => {
      const t = tool({
        vendorToolName: "Read",
        title: "read notes/x.md",
        mcpServer: "srv",
        locations: [{ path: "/Users/me/vault/notes/x.md" }],
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("srv · Read notes/x.md");
    });

    it("shows an ACP backend's friendly multi-word title verbatim", () => {
      const t = tool({ title: "Querying the database" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Querying the database");
    });

    it("falls back to 'Tool call' when there is no tool identity", () => {
      const t = tool({ title: "" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Tool call");
    });

    it("summarizes live subagent progress and omits stale descriptions after completion", () => {
      const running = tool({
        vendorToolName: "Agent",
        status: "in_progress",
        progress: {
          description: "Running Count markdown files and subfolders",
          toolUses: 3,
          durationMs: 9851,
        },
      });
      const done = tool({
        ...running,
        status: "completed",
        progress: { ...running.progress, toolUses: 19, durationMs: 66_000 },
      });

      expect(lookupToolSummary(running).outcome(running)).toBe(
        "Running Count markdown files and subfolders · 3 tools · 9s"
      );
      expect(lookupToolSummary(done).outcome(done)).toBe("19 tools · 1m 6s");
    });

    it("summarizes AskUserQuestion with the question header", () => {
      const t = tool({
        vendorToolName: "AskUserQuestion",
        title: "AskUserQuestion",
        status: "completed",
        input: {
          questions: [{ header: "Pick a backend", question: "Which backend?", options: [] }],
        },
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe('Asked: "Pick a backend"');
    });

    it("falls back to the question text (present tense while in flight) when there is no header", () => {
      const t = tool({
        vendorToolName: "AskUserQuestion",
        title: "AskUserQuestion",
        status: "in_progress",
        input: { questions: [{ question: "Which backend?", options: [] }] },
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe('Asking: "Which backend?"');
    });

    it("uses a generic AskUserQuestion line before input has streamed in", () => {
      const t = tool({ vendorToolName: "AskUserQuestion", title: "AskUserQuestion" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Asked a question");
    });

    it("names the invoked skill from input.skill", () => {
      const t = tool({
        vendorToolName: "Skill",
        title: "Skill",
        status: "completed",
        input: { skill: "copilot-read-pdf", args: "notes/foo.pdf — read chapter one" },
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Ran skill copilot-read-pdf");
    });

    it("renders the skill in present tense while in flight", () => {
      const t = tool({
        vendorToolName: "Skill",
        title: "Skill",
        status: "in_progress",
        input: { skill: "copilot-read-pdf" },
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Running skill copilot-read-pdf");
    });

    it("falls back to a generic skill line before input has streamed in", () => {
      const t = tool({ vendorToolName: "Skill", title: "Skill", status: "completed" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Ran a skill");
    });

    it("surfaces the skill args in the expanded card", () => {
      const t = tool({
        vendorToolName: "Skill",
        title: "Skill",
        status: "completed",
        input: { skill: "copilot-read-pdf", args: "notes/foo.pdf — read chapter one" },
      });
      expect(lookupToolSummary(t).expandedDetails?.(t)).toBe("notes/foo.pdf — read chapter one");
    });

    it("hides the duplicated vendor name while Read input is still streaming", () => {
      const t = tool({ vendorToolName: "Read", title: "Read", status: "in_progress" });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Reading …");
    });

    it("uses Editing while Edit is in flight and Edited when it completes", () => {
      const inflight = tool({
        vendorToolName: "Edit",
        title: "Edit",
        status: "in_progress",
        input: { file_path: "/Users/me/vault/draft.md" },
      });
      expect(lookupToolSummary(inflight).collapsedLine(inflight, CTX)).toBe("Editing draft.md");
      const done = tool({ ...inflight, status: "completed" });
      expect(lookupToolSummary(done).collapsedLine(done, CTX)).toBe("Edited draft.md");
    });

    it("says Didn't edit when a Claude Edit fails or is denied (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        vendorToolName: "Edit",
        title: "Edit",
        status: "failed",
        input: { file_path: "/Users/me/vault/plan.md" },
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit plan.md");
    });

    it("says Didn't edit when a Claude Write is denied with no diff, since its whole-file content cannot tell a create from an overwrite (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        vendorToolName: "Write",
        title: "Write",
        toolKind: "edit",
        status: "failed",
        input: { file_path: "/Users/me/vault/notes.md", content: "# Notes\n" },
        output: [{ type: "text", text: "User declined" }],
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit notes.md");
    });

    it("says Didn't edit when an OpenCode write of full content fails with no diff (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        toolKind: "edit",
        title: "notes.md",
        status: "failed",
        input: { filePath: "/Users/me/vault/notes.md", content: "# Notes\n" },
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit notes.md");
    });

    it("says Didn't create when a Codex diff adds a new file and fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        toolKind: "edit",
        title: "Editing files",
        status: "failed",
        output: [
          { type: "diff", path: "/Users/me/vault/notes.md", oldText: null, newText: "# Notes" },
        ],
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't create notes.md");
    });

    it("says Didn't edit when a Write replacing existing text fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        vendorToolName: "Write",
        title: "Write",
        status: "failed",
        input: { file_path: "/Users/me/vault/plan.md" },
        output: [{ type: "diff", path: "/Users/me/vault/plan.md", oldText: "old", newText: "new" }],
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit plan.md");
    });

    it("says Didn't edit for a failed Codex multi-file edit (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        toolKind: "edit",
        title: "Editing files",
        status: "failed",
        output: [
          { type: "diff", path: "src/a.ts", oldText: "a", newText: "A" },
          { type: "diff", path: "src/b.ts", oldText: "b", newText: "B" },
        ],
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit 2 files");
    });

    it("says Didn't edit for a failed OpenCode edit (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const failed = tool({
        toolKind: "edit",
        title: "plan.md",
        status: "failed",
        input: { filePath: "/Users/me/vault/plan.md" },
      });
      expect(lookupToolSummary(failed).collapsedLine(failed, CTX)).toBe("Didn't edit plan.md");
    });

    it("uses Deleting, Deleted and Didn't delete across the delete lifecycle (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const inflight = tool({
        toolKind: "delete",
        title: "old.md",
        status: "in_progress",
        input: { filePath: "/Users/me/vault/old.md" },
      });
      const summary = lookupToolSummary(inflight);
      expect(summary.collapsedLine(inflight, CTX)).toBe("Deleting old.md");
      expect(summary.collapsedLine({ ...inflight, status: "completed" }, CTX)).toBe(
        "Deleted old.md"
      );
      expect(summary.collapsedLine({ ...inflight, status: "failed" }, CTX)).toBe(
        "Didn't delete old.md"
      );
    });

    it("keeps past-tense labels on failed tools that do not change files (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const bash = tool({
        vendorToolName: "Bash",
        status: "failed",
        input: { command: "npm test" },
      });
      expect(lookupToolSummary(bash).collapsedLine(bash, CTX)).toBe("Ran `npm test`");
      const read = tool({
        vendorToolName: "Read",
        status: "failed",
        input: { file_path: "/Users/me/vault/plan.md" },
      });
      expect(lookupToolSummary(read).collapsedLine(read, CTX)).toBe("Read plan.md");
    });

    it("uses a single Codex diff path as the edit target", () => {
      const t = tool({
        toolKind: "edit",
        title: "Editing files",
        output: [
          {
            type: "diff",
            path: "/Users/me/vault/src/agentMode/ui/toolSummaries.ts",
            oldText: "before",
            newText: "after",
          },
        ],
      });
      const summary = lookupToolSummary(t);

      expect(summary.collapsedLine(t, CTX)).toBe("Edited src/agentMode/ui/toolSummaries.ts");
      expect(summary.targetPath?.(t, CTX)).toBe("src/agentMode/ui/toolSummaries.ts");

      const outsideVault = {
        ...t,
        output: [{ ...t.output![0], path: "/Users/me/private/draft.md" }],
      };
      expect(summary.collapsedLine(outsideVault, CTX)).toBe("Edited …/draft.md");
    });

    it("counts unique Codex diff paths for multi-file edits", () => {
      const inflight = tool({
        toolKind: "edit",
        title: "Editing files",
        status: "in_progress",
        output: [
          { type: "diff", path: "src/a.ts", oldText: "a", newText: "A" },
          { type: "diff", path: "src/a.ts", oldText: "A", newText: "AA" },
          { type: "diff", path: "src/b.ts", oldText: null, newText: "B" },
        ],
      });
      const summary = lookupToolSummary(inflight);

      expect(summary.collapsedLine(inflight, CTX)).toBe("Editing 2 files");
      const done = { ...inflight, status: "completed" as const };
      expect(summary.collapsedLine(done, CTX)).toBe("Edited 2 files");
      expect(summary.targetPath?.(done, CTX)).toBeNull();
    });

    it("preserves OpenCode filePath edit targets", () => {
      const t = tool({
        toolKind: "edit",
        title: "draft.md",
        input: { filePath: "/Users/me/vault/draft.md" },
      });

      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Edited draft.md");
    });

    it("uses Fetching while WebFetch is in flight and Fetched when it completes", () => {
      const inflight = tool({
        vendorToolName: "WebFetch",
        title: "WebFetch",
        status: "in_progress",
        input: { url: "https://example.com" },
      });
      expect(lookupToolSummary(inflight).collapsedLine(inflight, CTX)).toBe(
        "Fetching https://example.com"
      );
      const done = tool({ ...inflight, status: "completed" });
      expect(lookupToolSummary(done).collapsedLine(done, CTX)).toBe("Fetched https://example.com");
    });

    it("uses Running while Bash is in flight and Ran when it completes", () => {
      const inflight = tool({
        vendorToolName: "Bash",
        title: "Bash",
        status: "in_progress",
        input: { command: "git status" },
      });
      expect(lookupToolSummary(inflight).collapsedLine(inflight, CTX)).toBe("Running `git status`");
      const done = tool({ ...inflight, status: "completed" });
      expect(lookupToolSummary(done).collapsedLine(done, CTX)).toBe("Ran `git status`");
    });

    it("shows a Bash description verbatim because it already starts with its own verb", () => {
      const inflight = tool({
        vendorToolName: "Bash",
        status: "in_progress",
        input: { command: "git status", description: "Check working tree" },
      });
      expect(lookupToolSummary(inflight).collapsedLine(inflight, CTX)).toBe("Check working tree");
      const done = tool({ ...inflight, status: "completed" });
      expect(lookupToolSummary(done).collapsedLine(done, CTX)).toBe("Check working tree");
    });

    it("shows an execute-kind description verbatim for any agent that sends one", () => {
      const t = tool({
        toolKind: "execute",
        status: "completed",
        input: { command: "date", description: "Show current date and time" },
      });
      expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Show current date and time");
    });

    it("expands a Bash call to its full untruncated command", () => {
      const longCmd =
        "cd ~/Developer/obsidian-copilot && rg --multiline 'foo bar baz' src/**/*.ts | head -50";
      const t = tool({ vendorToolName: "Bash", input: { command: longCmd } });
      const s = lookupToolSummary(t);
      expect(s.collapsedLine(t, CTX).length).toBeLessThan(longCmd.length);
      expect(s.expandedDetails?.(t)).toBe(longCmd);
    });

    it("expands a Bash call with a description as a comment line above the command", () => {
      const t = tool({
        vendorToolName: "Bash",
        input: { command: "git status", description: "Check working tree" },
      });
      expect(lookupToolSummary(t).expandedDetails?.(t)).toBe("# Check working tree\ngit status");
    });

    it("expands a Bash call without a command to nothing", () => {
      const t = tool({ vendorToolName: "Bash", input: { description: "Run something" } });
      expect(lookupToolSummary(t).expandedDetails?.(t)).toBeNull();
    });

    it("expands a Bash call without input to nothing", () => {
      const t = tool({ vendorToolName: "Bash" });
      expect(lookupToolSummary(t).expandedDetails?.(t)).toBeNull();
    });

    it("offers no expanded details for Read and Edit calls", () => {
      const read = tool({ vendorToolName: "Read", title: "read" });
      expect(lookupToolSummary(read).expandedDetails).toBeUndefined();
      const edit = tool({ vendorToolName: "Edit", title: "edit" });
      expect(lookupToolSummary(edit).expandedDetails).toBeUndefined();
    });
  });

  describe("displayTargetFromPath()", () => {
    it("shows an in-vault target as its vault-relative path", () => {
      const t = tool({ input: { file_path: "/Users/me/vault/notes/today.md" } });
      expect(displayTargetFromPath(t, CTX.vaultBase)).toBe("notes/today.md");
    });

    it("shortens an out-of-vault target to its file name", () => {
      const t = tool({ input: { file_path: "/Users/me/private/draft.md" } });
      expect(displayTargetFromPath(t, CTX.vaultBase)).toBe("…/draft.md");
    });

    it("returns null when the tool call names no path", () => {
      expect(displayTargetFromPath(tool({ input: {} }), CTX.vaultBase)).toBeNull();
    });
  });

  describe("extractSubAgentReturnText()", () => {
    it("strips opencode <task_result> wrapper", () => {
      const t = tool({
        output: [
          { type: "text", text: "task_id: abc\n\n<task_result>The result here.</task_result>" },
        ],
      });
      expect(extractSubAgentReturnText(t)).toBe("The result here.");
    });

    it("returns plain text when no wrapper present", () => {
      const t = tool({ output: [{ type: "text", text: "  hello  " }] });
      expect(extractSubAgentReturnText(t)).toBe("hello");
    });

    it("returns null for parts with no text output", () => {
      expect(extractSubAgentReturnText(tool())).toBeNull();
    });

    it("returns null when output is identical to the input prompt", () => {
      const t = tool({
        input: { prompt: "do the research" },
        output: [{ type: "text", text: "do the research" }],
      });
      expect(extractSubAgentReturnText(t)).toBeNull();
    });

    it("returns the response when output is distinct from the input prompt", () => {
      const t = tool({
        input: { prompt: "do the research" },
        output: [{ type: "text", text: "Here is what I found: …" }],
      });
      expect(extractSubAgentReturnText(t)).toBe("Here is what I found: …");
    });
  });

  describe("extractSubAgentInputPrompt()", () => {
    it("returns the prompt string when present", () => {
      const t = tool({ input: { prompt: "  do the research  " } });
      expect(extractSubAgentInputPrompt(t)).toBe("do the research");
    });

    it("returns null when input has no prompt", () => {
      expect(extractSubAgentInputPrompt(tool({ input: { description: "x" } }))).toBeNull();
      expect(extractSubAgentInputPrompt(tool())).toBeNull();
    });

    it("returns null when prompt is empty or whitespace", () => {
      expect(extractSubAgentInputPrompt(tool({ input: { prompt: "" } }))).toBeNull();
      expect(extractSubAgentInputPrompt(tool({ input: { prompt: "   " } }))).toBeNull();
    });
  });

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
