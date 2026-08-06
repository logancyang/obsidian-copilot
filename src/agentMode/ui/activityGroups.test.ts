import {
  foldActivityGroups,
  summarizeActivity,
  type ActivityMember,
  type GroupedTrailNode,
} from "@/agentMode/ui/activityGroups";
import { buildAgentTrail, type RenderNode, type ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";

function tool(id: string, overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return { kind: "tool_call", id, title: id, status: "completed", ...overrides };
}

function action(id: string, overrides: Partial<ToolCallPart> = {}): RenderNode {
  return { type: "action", part: tool(id, overrides) };
}

function reasoning(text = "thinking"): RenderNode {
  return { type: "reasoning", part: { kind: "thought", text } };
}

function prose(text = "Here is what I found."): RenderNode {
  return { type: "text", part: { kind: "text", text } };
}

function member(id: string, overrides: Partial<ToolCallPart> = {}): ActivityMember {
  return { type: "action", part: tool(id, overrides) };
}

const REASONING_MEMBER: ActivityMember = {
  type: "reasoning",
  part: { kind: "thought", text: "…" },
};

function types(nodes: GroupedTrailNode[]): string[] {
  return nodes.map((n) => n.type);
}

function groupAt(nodes: GroupedTrailNode[], index: number) {
  const node = nodes[index];
  if (node.type !== "activityGroup") throw new Error(`node ${index} is ${node.type}`);
  return node;
}

describe("activityGroups", () => {
  describe("foldActivityGroups()", () => {
    it("folds a run of different tool families into one group", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        action("c", { vendorToolName: "Edit" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup"]);
      expect(groupAt(grouped, 0).members).toHaveLength(3);
    });

    it("folds reasoning together with the tool calls around it", () => {
      const grouped = foldActivityGroups([
        reasoning(),
        action("a", { vendorToolName: "Bash" }),
        reasoning(),
        action("b", { vendorToolName: "Bash" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup"]);
      expect(groupAt(grouped, 0).members.map((m) => m.type)).toEqual([
        "reasoning",
        "action",
        "reasoning",
        "action",
      ]);
    });

    it("leaves a lone tool call as a plain action row rather than a one-member group", () => {
      const grouped = foldActivityGroups([action("a", { vendorToolName: "Read" }), prose()]);
      expect(types(grouped)).toEqual(["action", "text"]);
    });

    it("leaves a lone reasoning block as a plain reasoning row", () => {
      const grouped = foldActivityGroups([prose(), reasoning(), prose()]);
      expect(types(grouped)).toEqual(["text", "reasoning", "text"]);
    });

    it("splits a run in two when prose interrupts it", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        prose(),
        action("c", { vendorToolName: "Edit" }),
        action("d", { vendorToolName: "Edit" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup", "text", "activityGroup"]);
    });

    it("keeps a sub-agent launch as its own row and breaks the run around it", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        { type: "subagent", parent: tool("t", { vendorToolName: "Task" }), children: [] },
        action("c", { vendorToolName: "Read" }),
        action("d", { vendorToolName: "Bash" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup", "subagent", "activityGroup"]);
    });

    it.each(["AskUserQuestion", "ExitPlanMode", "EnterPlanMode"])(
      "keeps %s out of a group so the user can still act on it",
      (vendorToolName) => {
        const grouped = foldActivityGroups([
          action("a", { vendorToolName: "Read" }),
          action("b", { vendorToolName: "Bash" }),
          action("q", { vendorToolName }),
          action("c", { vendorToolName: "Read" }),
          action("d", { vendorToolName: "Bash" }),
        ]);
        expect(types(grouped)).toEqual(["activityGroup", "action", "activityGroup"]);
      }
    );

    it("keeps a backend-neutral switch-mode tool out of a group", () => {
      const grouped = foldActivityGroups([
        action("a", { toolKind: "read" }),
        action("b", { toolKind: "execute" }),
        action("plan", { toolKind: "switch_mode" }),
        action("c", { toolKind: "read" }),
        action("d", { toolKind: "execute" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup", "action", "activityGroup"]);
    });

    it("groups an MCP tool that shares a bare name with an interactive native tool", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("q", { vendorToolName: "ExitPlanMode", mcpServer: "srv" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup"]);
      expect(groupAt(grouped, 0).members).toHaveLength(2);
    });

    it("breaks the run on a plan checklist", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        { type: "plan", part: { kind: "plan", entries: [] } },
        action("c", { vendorToolName: "Read" }),
        action("d", { vendorToolName: "Bash" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup", "plan", "activityGroup"]);
    });

    it("numbers groups by position so an id survives members streaming in", () => {
      const first = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        prose(),
        action("c", { vendorToolName: "Read" }),
        action("d", { vendorToolName: "Bash" }),
      ]);
      const grown = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        prose(),
        action("c", { vendorToolName: "Read" }),
        action("d", { vendorToolName: "Bash" }),
        action("e", { vendorToolName: "Edit" }),
      ]);
      expect(groupAt(first, 0).id).toBe("activity-0");
      expect(groupAt(first, 2).id).toBe("activity-1");
      expect(groupAt(grown, 2).id).toBe("activity-1");
      expect(groupAt(grown, 2).members).toHaveLength(3);
    });

    it("returns the same canonical empty trail on every empty call", () => {
      expect(foldActivityGroups([])).toEqual([]);
      expect(foldActivityGroups([])).toBe(foldActivityGroups([]));
    });

    it("groups the interleaved tool-and-reasoning stream a real turn produces", () => {
      const parts: AgentMessagePart[] = [
        { kind: "thought", text: "plan" },
        tool("s", { vendorToolName: "Skill" }),
        { kind: "thought", text: "next" },
        tool("b1", { vendorToolName: "Bash" }),
        { kind: "thought", text: "next" },
        tool("b2", { vendorToolName: "Bash" }),
        { kind: "text", text: "Found it." },
        tool("e", { vendorToolName: "Edit" }),
      ];
      const grouped = foldActivityGroups(buildAgentTrail(parts));
      expect(types(grouped)).toEqual(["activityGroup", "text", "action"]);
      expect(groupAt(grouped, 0).members).toHaveLength(6);
    });
  });

  describe("summarizeActivity()", () => {
    it("names each tool family in first-appearance order", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Read" }),
        member("b", { vendorToolName: "Read" }),
        member("c", { vendorToolName: "Bash" }),
      ]);
      expect(line).toBe("Read 2 files, ran 1 command");
    });

    it("pools tools that mean the same thing into one phrase", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Edit" }),
        member("b", { vendorToolName: "Write" }),
        member("c", { vendorToolName: "MultiEdit" }),
      ]);
      expect(line).toBe("Edited 3 files");
    });

    it("falls back to the ACP tool kind when there is no vendor name", () => {
      const { line } = summarizeActivity([
        member("a", { toolKind: "execute" }),
        member("b", { toolKind: "read" }),
      ]);
      expect(line).toBe("Ran 1 command, read 1 file");
    });

    it("counts every tool that is not a read or an edit as a command", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Grep" }),
        member("b", { vendorToolName: "WebFetch" }),
        member("c", { vendorToolName: "Skill" }),
        member("d", { vendorToolName: "DesignSync" }),
        member("e", { vendorToolName: "search_flows", mcpServer: "mobbin" }),
      ]);
      expect(line).toBe("Ran 5 commands");
    });

    it("adds a later member of an earlier family to its count rather than a new phrase", () => {
      const { line } = summarizeActivity([
        member("b", { vendorToolName: "Bash" }),
        member("r", { vendorToolName: "Read" }),
        member("g", { vendorToolName: "Grep" }),
      ]);
      expect(line).toBe("Ran 2 commands, read 1 file");
    });

    it("does not let an MCP tool named like a native read count as one", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Read", mcpServer: "srv" }),
      ]);
      expect(line).toBe("Ran 1 command");
    });

    it("appends the measured reasoning time", () => {
      const { line } = summarizeActivity(
        [member("a", { vendorToolName: "Bash" }), REASONING_MEMBER],
        { thinkingMs: 51_000 }
      );
      expect(line).toBe("Ran 1 command, thought for 51s");
    });

    it("omits a reasoning duration under a second rather than saying '< 1s'", () => {
      const { line } = summarizeActivity(
        [member("a", { vendorToolName: "Bash" }), REASONING_MEMBER],
        { thinkingMs: 400 }
      );
      expect(line).toBe("Ran 1 command");
    });

    it("still reports reasoning when it is all the group did", () => {
      const { line } = summarizeActivity([REASONING_MEMBER, REASONING_MEMBER]);
      expect(line).toBe("Thought");
    });

    it("counts failed members without naming them in the line", () => {
      const { line, failed } = summarizeActivity([
        member("a", { vendorToolName: "Bash" }),
        member("b", { vendorToolName: "Bash", status: "failed" }),
      ]);
      expect(line).toBe("Ran 2 commands");
      expect(failed).toBe(1);
    });

    it("reports no failures for a clean group", () => {
      expect(summarizeActivity([member("a", { vendorToolName: "Bash" })]).failed).toBe(0);
    });

    it("describes an empty group without producing an empty line", () => {
      expect(summarizeActivity([])).toEqual({ line: "Worked", failed: 0 });
    });
  });
});
