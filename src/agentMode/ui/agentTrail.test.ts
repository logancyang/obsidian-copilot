import { agentResponseText, buildAgentTrail, type RenderNode } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";

function tool(
  id: string,
  overrides: Partial<Extract<AgentMessagePart, { kind: "tool_call" }>> = {}
): AgentMessagePart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status: "completed",
    ...overrides,
  };
}

function thought(text: string): AgentMessagePart {
  return { kind: "thought", text };
}

function text(value: string): AgentMessagePart {
  return { kind: "text", text: value };
}

/** Wrap tool_call parts as children of a sub-agent (Task) so the trail builder
 *  treats them as depth-1 peers. */
function withSubagent(parent: string, children: AgentMessagePart[]): AgentMessagePart[] {
  return [
    tool(parent, { vendorToolName: "Task" }),
    ...children.map((c) => (c.kind === "tool_call" ? { ...c, parentToolCallId: parent } : c)),
  ];
}

describe("buildAgentTrail", () => {
  it("renders heterogeneous tools as separate action nodes", () => {
    const parts = [
      tool("a", { vendorToolName: "Read" }),
      tool("b", { vendorToolName: "Edit" }),
      tool("c", { vendorToolName: "Grep" }),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["action", "action", "action"]);
  });

  it("nests sub-agent children under the parent", () => {
    const parts = [
      tool("task1", { vendorToolName: "Task" }),
      tool("c1", { vendorToolName: "Read", parentToolCallId: "task1" }),
      tool("c2", { vendorToolName: "Read", parentToolCallId: "task1" }),
      tool("c3", { vendorToolName: "Grep", parentToolCallId: "task1" }),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("subagent");
    if (tree[0].type === "subagent") {
      expect(tree[0].parent.id).toBe("task1");
      expect(
        tree[0].children.map((n: RenderNode) => (n.type === "action" ? n.part.id : n.type))
      ).toEqual(["c1", "c2", "c3"]);
    }
  });

  it("groups a background (childless) sub-agent launch as a subagent node", () => {
    // A launch can still be childless when no complete nested frame arrived;
    // the card remains a group so the final report has a home.
    const parts = [
      tool("launch", {
        vendorToolName: "Agent",
        input: { subagent_type: "Explore", description: "Analyze notes" },
        output: [{ type: "text", text: "Most prominent: AI/agents (16)." }],
      }),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("subagent");
    if (tree[0].type === "subagent") {
      expect(tree[0].parent.id).toBe("launch");
      expect(tree[0].children).toHaveLength(0);
    }
  });

  it.each(["Agent", "Task"])(
    "renders an MCP tool named %s as an action rather than a subagent",
    (vendorToolName) => {
      const tree = buildAgentTrail([
        tool("mcp-tool", { vendorToolName, mcpServer: "srv", toolKind: "think" }),
      ]);
      expect(tree[0].type).toBe("action");
    }
  );

  it("recognizes an opencode task tool (subagent_type input) as a subagent group", () => {
    const parts = [tool("t", { input: { subagent_type: "general" } })];
    const tree = buildAgentTrail(parts);
    expect(tree[0].type).toBe("subagent");
  });

  it.each([
    ["a named vendor tool", { vendorToolName: "RunAnalysis" }],
    ["an anonymous MCP tool", { mcpServer: "analysis-server", toolKind: "other" }],
    ["a typed native tool", { toolKind: "execute" }],
  ] as const)(
    "does not classify %s with a subagent_type parameter as a subagent",
    (_label, identity) => {
      const tree = buildAgentTrail([
        tool("ordinary", { ...identity, input: { subagent_type: "worker" } }),
      ]);
      expect(tree[0].type).toBe("action");
    }
  );

  it("treats orphan parentToolCallId as top-level", () => {
    const parts = [tool("c1", { vendorToolName: "Read", parentToolCallId: "missing" })];
    const tree = buildAgentTrail(parts);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("action");
  });

  it("caps recursion depth", () => {
    // depth 0: t0 -> depth 1: t1 -> depth 2: t2 (truncated when maxDepth=2)
    const parts = [
      tool("t0", { vendorToolName: "Task" }),
      tool("t1", { vendorToolName: "Task", parentToolCallId: "t0" }),
      tool("t2", { vendorToolName: "Task", parentToolCallId: "t1" }),
      tool("c", { vendorToolName: "Read", parentToolCallId: "t2" }),
    ];
    const tree = buildAgentTrail(parts, { maxDepth: 2 });
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("subagent");
    if (tree[0].type === "subagent") {
      // depth 1 sub-agent rendered with no children (depth+1 === maxDepth)
      const inner = tree[0].children;
      expect(inner).toHaveLength(1);
      expect(inner[0].type).toBe("subagent");
      if (inner[0].type === "subagent") {
        expect(inner[0].truncated).toBe(true);
        expect(inner[0].children).toHaveLength(0);
      }
    }
  });

  it("emits text parts as their own peer nodes", () => {
    const parts: AgentMessagePart[] = [
      text("Hello, "),
      tool("a", { vendorToolName: "Read" }),
      text("world."),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["text", "action", "text"]);
  });

  it("drops empty/whitespace-only text parts so they don't add a flex-gap row", () => {
    const parts: AgentMessagePart[] = [
      thought("thinking..."),
      text(""),
      tool("a", { vendorToolName: "Read" }),
      text("   \n  "),
      text("real prose"),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["reasoning", "action", "text"]);
  });

  describe("hidden tools", () => {
    it("drops ToolSearch entirely, leaving the surrounding tool", () => {
      const parts = [
        tool("ts", { vendorToolName: "ToolSearch" }),
        tool("epm", { vendorToolName: "ExitPlanMode" }),
      ];
      const tree = buildAgentTrail(parts);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe("action");
      if (tree[0].type === "action") {
        expect(tree[0].part.id).toBe("epm");
      }
    });

    it("leaves the tools that flank a hidden one adjacent", () => {
      const parts = [
        tool("r1", { vendorToolName: "Read" }),
        tool("ts", { vendorToolName: "ToolSearch" }),
        tool("r2", { vendorToolName: "Read" }),
      ];
      const tree = buildAgentTrail(parts);
      expect(tree.map((n) => (n.type === "action" ? n.part.id : n.type))).toEqual(["r1", "r2"]);
    });

    it("filters hidden tools inside a sub-agent too", () => {
      const parts = withSubagent("task1", [
        tool("r1", { vendorToolName: "Read" }),
        tool("ts", { vendorToolName: "ToolSearch" }),
        tool("r2", { vendorToolName: "Read" }),
      ]);
      const tree = buildAgentTrail(parts);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe("subagent");
      if (tree[0].type !== "subagent") return;
      expect(tree[0].children.map((n) => (n.type === "action" ? n.part.id : n.type))).toEqual([
        "r1",
        "r2",
      ]);
    });
  });

  it("renders plan and reasoning parts as their own nodes", () => {
    const parts: AgentMessagePart[] = [
      thought("thinking..."),
      {
        kind: "plan",
        entries: [{ content: "step 1", priority: "medium", status: "pending" }],
      },
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["reasoning", "plan"]);
  });
});

describe("agentResponseText", () => {
  it("collects all text parts in stream order, even across interleaved research", () => {
    const parts: AgentMessagePart[] = [
      thought("let me search the vault"),
      tool("a", { vendorToolName: "Grep" }),
      text("Early prose emitted before the research finished."),
      tool("b", { vendorToolName: "Read" }),
      text("The wrap-up after the research."),
    ];
    // Both prose segments are captured — the earlier one is no longer dropped
    // just because a tool_call follows it.
    expect(agentResponseText(parts)).toBe(
      "Early prose emitted before the research finished.\n\nThe wrap-up after the research."
    );
  });

  it("joins text parts split by a thought", () => {
    const parts: AgentMessagePart[] = [text("A"), thought("Thought for < 1s"), text("B")];
    expect(agentResponseText(parts)).toBe("A\n\nB");
  });

  it("joins text parts split by a tool call", () => {
    const parts: AgentMessagePart[] = [text("A"), tool("x"), text("B")];
    expect(agentResponseText(parts)).toBe("A\n\nB");
  });

  it("drops a whitespace-only text part without leaving a stray blank line", () => {
    const parts: AgentMessagePart[] = [text("A"), text("   "), text("B")];
    expect(agentResponseText(parts)).toBe("A\n\nB");
  });

  it("sanitizes the text the same way legacy chat copy does", () => {
    const parts: AgentMessagePart[] = [
      tool("a"),
      text("<think>internal</think>The answer.\n\n\n\nMore.   "),
    ];
    // removeThinkTags strips the think block, 3+ newlines collapse to 2, and
    // trailing whitespace is trimmed — matching `cleanMessageForCopy`.
    expect(agentResponseText(parts)).toBe("The answer.\n\nMore.");
  });

  it("returns an empty string when the turn produced no prose", () => {
    expect(agentResponseText([thought("..."), tool("a")])).toBe("");
    expect(agentResponseText([])).toBe("");
  });
});
