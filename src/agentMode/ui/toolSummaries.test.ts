import {
  lookupToolSummary,
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
} from "@/agentMode/ui/toolSummaries";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

jest.mock("@/agentMode/ui/vaultPath", () => {
  const actual = jest.requireActual("@/agentMode/ui/vaultPath");
  return {
    ...actual,
    getVaultBase: () => "/Users/me/vault",
  };
});

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
    expect(s.collapsedLine(t)).toMatch(/^Read /);
    expect(s.outcome(t)).toMatch(/tokens$/);
  });

  it("renders Read paths relative to the vault root", () => {
    const t = tool({
      vendorToolName: "Read",
      title: "read",
      locations: [{ path: "/Users/me/vault/notes/music-theory.md" }],
    });
    expect(lookupToolSummary(t).collapsedLine(t)).toBe("Read notes/music-theory.md");
  });

  it("falls back to the original path when the file is outside the vault", () => {
    const t = tool({
      vendorToolName: "Read",
      title: "read",
      locations: [{ path: "/etc/passwd" }],
    });
    expect(lookupToolSummary(t).collapsedLine(t)).toBe("Read /etc/passwd");
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
    expect(s.collapsedLine(t)).toBe('research-agent · "find jazz voicings"');
  });

  it('routes Claude Code\'s "Agent" vendor name to the sub-agent summary', () => {
    // Claude Code surfaces the parent Task call with
    // `_meta.claudeCode.toolName: "Agent"` (NOT "Task"). Without this
    // alias the lookup falls through to KIND_THINK_SUMMARY (Brain icon,
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
    expect(s.collapsedLine(t)).toBe('Explore · "Map user-facing features of obsidian-copilot"');
    // Same summary as the Task vendor name — the alias just routes through.
    const taskEquiv = lookupToolSummary({ ...t, vendorToolName: "Task" });
    expect(s).toBe(taskEquiv);
  });

  it("maps vault MCP tools onto built-in Read/Edit/Search summaries", () => {
    const read = tool({
      vendorToolName: "vault_read",
      toolKind: "read",
      title: "vault_read Daily/2026-05-01.md",
      input: { path: "Daily/2026-05-01.md" },
    });
    expect(lookupToolSummary(read).collapsedLine(read)).toBe("Read Daily/2026-05-01.md");

    const edit = tool({
      vendorToolName: "vault_edit",
      toolKind: "edit",
      title: "vault_edit notes/x.md",
      input: { path: "notes/x.md" },
      output: [{ type: "diff", path: "notes/x.md", oldText: "a", newText: "b\nc" }],
    });
    expect(lookupToolSummary(edit).collapsedLine(edit)).toBe("Edited notes/x.md");

    const list = tool({
      vendorToolName: "vault_list",
      title: "vault_list Daily",
      input: { path: "Daily" },
    });
    expect(lookupToolSummary(list).collapsedLine(list)).toBe("Listed Daily");

    const grep = tool({
      vendorToolName: "vault_grep",
      title: "vault_grep TODO",
      input: { pattern: "TODO" },
    });
    expect(lookupToolSummary(grep).collapsedLine(grep)).toBe('Searched vault · "TODO"');
  });

  it("falls back to ACP toolKind when vendor is missing", () => {
    const t = tool({ toolKind: "edit", title: "wrote thing" });
    const s = lookupToolSummary(t);
    expect(s.collapsedLine(t)).toMatch(/^Edited /);
  });

  it("falls back to generic when both vendor and toolKind are unknown", () => {
    const t = tool({ title: "weirdtool" });
    const s = lookupToolSummary(t);
    expect(s.collapsedLine(t)).toBe("weirdtool");
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
