import {
  lookupToolSummary,
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
} from "@/agentMode/ui/toolSummaries";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

// Fixed ctx for every test — mirrors what `ActionCard` would resolve via
// `getVaultBase(app)`. Lets us exercise vault-relative path rendering
// without mocking the entire `app` object.
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

describe("lookupToolSummary", () => {
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

  it("falls back to the original path when the file is outside the vault", () => {
    const t = tool({
      vendorToolName: "Read",
      title: "read",
      locations: [{ path: "/etc/passwd" }],
    });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Read /etc/passwd");
  });

  it("aggregates Edits with combined +/- line counts and counts notes", () => {
    const e1 = tool({
      vendorToolName: "Edit",
      output: [{ type: "diff", path: "a.md", oldText: "x\ny\nz", newText: "x\ny" }],
    });
    const e2 = tool({
      vendorToolName: "Edit",
      output: [{ type: "diff", path: "b.md", oldText: null, newText: "a\nb\nc\nd" }],
    });
    const s = lookupToolSummary(e1).aggregate([e1, e2]);
    expect(s.line).toBe("Edited 2 notes");
    // e1: -3 / +2; e2: -0 / +4
    expect(s.outcome).toBe("+6 / −3 lines");
  });

  it("surfaces mixed status in the aggregate line", () => {
    const ok = tool({ vendorToolName: "Edit", status: "completed" });
    const bad = tool({ vendorToolName: "Edit", status: "failed" });
    const s = lookupToolSummary(ok).aggregate([ok, ok, bad]);
    expect(s.line).toContain("3 notes");
    expect(s.line).toContain("failed");
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
    // Claude Code surfaces the parent Task call with
    // `vendorToolName: "Agent"` (NOT "Task"). Without this alias the
    // lookup falls through to KIND_THINK_SUMMARY (Brain icon,
    // "Thought" line) which makes the sub-agent card look like a
    // reasoning block containing tool calls.
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
    // Same summary as the Task vendor name — the alias just routes through.
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
    expect(s.collapsedLine(t, CTX)).toMatch(/^Edited /);
  });

  it("falls back to generic when both vendor and toolKind are unknown", () => {
    const t = tool({ title: "weirdtool" });
    const s = lookupToolSummary(t);
    expect(s.collapsedLine(t, CTX)).toBe("Weirdtool");
  });

  it("humanizes a generic tool name instead of rendering '…'", () => {
    // SDK seeds title to the (bare) tool name, so title === vendorToolName.
    // Without the generic label this collapsed to "…".
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
    // `mcp__srv__read` strips to bare `read`, which resolves to the Read/kind
    // summary; the server prefix must still surface so it doesn't masquerade
    // as the native Read tool.
    const t = tool({
      vendorToolName: "Read",
      title: "read notes/x.md",
      mcpServer: "srv",
      locations: [{ path: "/Users/me/vault/notes/x.md" }],
    });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("srv · Read notes/x.md");
  });

  it("keeps the 'server ·' prefix on the compacted aggregate line", () => {
    // Two consecutive MCP reads fold into an AggregateCard, which renders
    // `summary.aggregate(parts).line` rather than `collapsedLine`. The server
    // prefix must survive compaction so the aggregate doesn't masquerade as a
    // native "Read 2 notes".
    const r1 = tool({ vendorToolName: "Read", mcpServer: "srv" });
    const r2 = tool({ vendorToolName: "Read", mcpServer: "srv" });
    expect(lookupToolSummary(r1).aggregate([r1, r2]).line).toBe("srv · Read 2 notes");
  });

  it("shows an ACP backend's friendly multi-word title verbatim", () => {
    const t = tool({ title: "Querying the database" });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Querying the database");
  });

  it("falls back to 'Tool call' when there is no tool identity", () => {
    const t = tool({ title: "" });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Tool call");
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

  it("hides the duplicated vendor name while Read input is still streaming", () => {
    // SDK seeds title to the vendor name before any input-JSON has been
    // parsed. Should render "Reading …" rather than "Reading Read".
    const t = tool({ vendorToolName: "Read", title: "Read", status: "in_progress" });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Reading …");
  });

  it("flips Read to past tense once the call completes", () => {
    const t = tool({
      vendorToolName: "Read",
      title: "Read",
      status: "completed",
      locations: [{ path: "/Users/me/vault/notes/foo.md" }],
    });
    expect(lookupToolSummary(t).collapsedLine(t, CTX)).toBe("Read notes/foo.md");
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
      input: { description: "Check working tree" },
    });
    expect(lookupToolSummary(inflight).collapsedLine(inflight, CTX)).toBe(
      "Running Check working tree"
    );
    const done = tool({ ...inflight, status: "completed" });
    expect(lookupToolSummary(done).collapsedLine(done, CTX)).toBe("Ran Check working tree");
  });
});

describe("BASH_SUMMARY.expandedDetails", () => {
  it("returns the full untruncated command", () => {
    const longCmd =
      "cd ~/Developer/obsidian-copilot && rg --multiline 'foo bar baz' src/**/*.ts | head -50";
    const t = tool({ vendorToolName: "Bash", input: { command: longCmd } });
    const s = lookupToolSummary(t);
    expect(s.collapsedLine(t, CTX).length).toBeLessThan(longCmd.length); // collapsed truncates
    expect(s.expandedDetails?.(t)).toBe(longCmd);
  });

  it("prefixes description as a comment when both are present", () => {
    const t = tool({
      vendorToolName: "Bash",
      input: { command: "git status", description: "Check working tree" },
    });
    expect(lookupToolSummary(t).expandedDetails?.(t)).toBe("# Check working tree\ngit status");
  });

  it("returns null when command is missing", () => {
    const t = tool({ vendorToolName: "Bash", input: { description: "Run something" } });
    expect(lookupToolSummary(t).expandedDetails?.(t)).toBeNull();
  });

  it("returns null when input is missing entirely", () => {
    const t = tool({ vendorToolName: "Bash" });
    expect(lookupToolSummary(t).expandedDetails?.(t)).toBeNull();
  });
});

describe("expandedDetails scoping", () => {
  it("is not defined for non-Bash summaries", () => {
    const read = tool({ vendorToolName: "Read", title: "read" });
    expect(lookupToolSummary(read).expandedDetails).toBeUndefined();
    const edit = tool({ vendorToolName: "Edit", title: "edit" });
    expect(lookupToolSummary(edit).expandedDetails).toBeUndefined();
  });
});

describe("extractSubAgentReturnText", () => {
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
    // Claude Code echoes the prompt as the Agent tool's `content` before
    // the sub-agent has produced anything. That echo should not render
    // as the sub-agent's response.
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

describe("extractSubAgentInputPrompt", () => {
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
