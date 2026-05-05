import { buildAgentTrail, type RenderNode } from "@/agentMode/ui/agentTrail";
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

/**
 * Wrap a list of tool_call parts as children of a sub-agent (Task) so the
 * trail builder treats them as depth-1 peers — the level where compaction
 * is enabled. Used to keep "compaction inside a sub-agent" cases concise.
 */
function withSubagent(parent: string, children: AgentMessagePart[]): AgentMessagePart[] {
  return [
    tool(parent, { vendorToolName: "Task" }),
    ...children.map((c) =>
      c.kind === "tool_call" ? ({ ...c, parentToolCallId: parent } as AgentMessagePart) : c
    ),
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

  it("compacts five consecutive Edits at the root level into one aggregate", () => {
    const parts = Array.from({ length: 5 }, (_, i) => tool(`e${i}`, { vendorToolName: "Edit" }));
    const tree = buildAgentTrail(parts);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("aggregate");
    if (tree[0].type === "aggregate") {
      expect(tree[0].parts).toHaveLength(5);
      expect(tree[0].toolKey).toBe("Edit");
    }
  });

  it("compacts seven consecutive Reads at the root level into one aggregate", () => {
    const parts = Array.from({ length: 7 }, (_, i) => tool(`r${i}`, { vendorToolName: "Read" }));
    const tree = buildAgentTrail(parts);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("aggregate");
    if (tree[0].type === "aggregate") {
      expect(tree[0].parts).toHaveLength(7);
      expect(tree[0].toolKey).toBe("Read");
    }
  });

  it("compacts five consecutive Edits inside a sub-agent into one aggregate", () => {
    const edits = Array.from({ length: 5 }, (_, i) => tool(`e${i}`, { vendorToolName: "Edit" }));
    const tree = buildAgentTrail(withSubagent("task1", edits));
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("subagent");
    if (tree[0].type === "subagent") {
      expect(tree[0].children).toHaveLength(1);
      const inner = tree[0].children[0];
      expect(inner.type).toBe("aggregate");
      if (inner.type === "aggregate") {
        expect(inner.parts).toHaveLength(5);
        expect(inner.toolKey).toBe("Edit");
      }
    }
  });

  it("a thought between root-level edits breaks compaction into two aggregates", () => {
    // Compaction now applies at root, so adjacent edits collapse — but any
    // intervening non-tool node forces the next same-tool call to start a
    // fresh run. The thought lands between two `aggregate` nodes.
    const parts: AgentMessagePart[] = [
      tool("e1", { vendorToolName: "Edit" }),
      tool("e2", { vendorToolName: "Edit" }),
      thought("hmm"),
      tool("e3", { vendorToolName: "Edit" }),
      tool("e4", { vendorToolName: "Edit" }),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["aggregate", "reasoning", "aggregate"]);
  });

  it("inside a sub-agent: falls back to toolKind when vendorToolName is absent", () => {
    const parts = withSubagent("task1", [
      tool("a", { toolKind: "edit" }),
      tool("b", { toolKind: "edit" }),
      tool("c", { toolKind: "read" }),
    ]);
    const tree = buildAgentTrail(parts);
    expect(tree[0].type).toBe("subagent");
    if (tree[0].type !== "subagent") return;
    expect(tree[0].children.map((n: RenderNode) => n.type)).toEqual(["aggregate", "action"]);
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
      // Two consecutive Reads compact (depth=1), then a Grep
      expect(tree[0].children.map((n: RenderNode) => n.type)).toEqual(["aggregate", "action"]);
    }
  });

  it("a sub-agent breaks the run; same-tool peers around it compact independently", () => {
    const parts = [
      tool("e1", { vendorToolName: "Edit" }),
      tool("task1", { vendorToolName: "Task" }),
      tool("c1", { vendorToolName: "Read", parentToolCallId: "task1" }),
      tool("e2", { vendorToolName: "Edit" }),
      tool("e3", { vendorToolName: "Edit" }),
    ];
    const tree = buildAgentTrail(parts);
    // Lone leading Edit can't compact (one peer), the trailing pair does.
    expect(tree.map((n) => n.type)).toEqual(["action", "subagent", "aggregate"]);
  });

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

  it("a streamed text part between root-level edits breaks compaction", () => {
    // Text parts always live at the root and have no parent linkage. A
    // streamed text chunk between same-tool peers acts as a separator: the
    // edits flanking it form independent aggregates.
    const parts: AgentMessagePart[] = [
      tool("e1", { vendorToolName: "Edit" }),
      tool("e2", { vendorToolName: "Edit" }),
      text("about to edit more..."),
      tool("e3", { vendorToolName: "Edit" }),
      tool("e4", { vendorToolName: "Edit" }),
    ];
    const tree = buildAgentTrail(parts);
    expect(tree.map((n) => n.type)).toEqual(["aggregate", "text", "aggregate"]);
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

    it("does not break compaction — Reads flanking a hidden tool still aggregate", () => {
      const parts = [
        tool("r1", { vendorToolName: "Read" }),
        tool("ts", { vendorToolName: "ToolSearch" }),
        tool("r2", { vendorToolName: "Read" }),
      ];
      const tree = buildAgentTrail(parts);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe("aggregate");
      if (tree[0].type === "aggregate") {
        expect(tree[0].parts.map((p) => p.id)).toEqual(["r1", "r2"]);
      }
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
      expect(tree[0].children).toHaveLength(1);
      const inner = tree[0].children[0];
      expect(inner.type).toBe("aggregate");
      if (inner.type === "aggregate") {
        expect(inner.parts.map((p) => p.id)).toEqual(["r1", "r2"]);
      }
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
