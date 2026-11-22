import {
  foldActivityGroups,
  summarizeActivity,
  type ActivityMember,
  type GroupedTrailNode,
  type ToolCardKind,
} from "@/agentMode/ui/activityGroups";
import { buildAgentTrail, type RenderNode, type ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { miyoSearchCall } from "@/miyo/agentMode/testing/miyoSearchCall";
import { excalidrawToolCall } from "@/excalidraw/agentMode/testing/excalidrawToolCall";
import { makeCommandTask } from "@/agentMode/ui/testing/taskFixtures";

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

    it("keeps a Miyo search out of the group so its card stays visible (https://github.com/Brevilabs/obsidian-copilot-private/issues/718)", () => {
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Grep" }),
        { type: "action", part: miyoSearchCall() },
        action("c", { vendorToolName: "Read" }),
        action("d", { vendorToolName: "Read" }),
      ]);
      expect(types(grouped)).toEqual(["activityGroup", "toolCard", "activityGroup"]);
    });

    describe("with tool card kinds (https://github.com/Brevilabs/obsidian-copilot-private/issues/793)", () => {
      const NOTE_CARD: ToolCardKind = {
        place: (part) =>
          part.vendorToolName === "note_tool"
            ? { joinKey: (part.input as { note?: string }).note ?? null }
            : null,
        render: () => null,
      };
      const SEARCH_CARD: ToolCardKind = {
        place: (part) => (part.vendorToolName === "search_tool" ? { joinKey: null } : null),
        render: () => null,
      };
      const fold = (nodes: RenderNode[]) =>
        foldActivityGroups(nodes, { tasks: null }, [NOTE_CARD, SEARCH_CARD]);
      const onNote = (id: string, note?: string) =>
        action(id, { vendorToolName: "note_tool", input: { note } });
      const cardAt = (nodes: GroupedTrailNode[], index: number) => {
        const node = nodes[index];
        if (node.type !== "toolCard") throw new Error(`node ${index} is ${node.type}`);
        return { kind: node.kind, ids: node.members.map((part) => part.id) };
      };

      it("joins a call to the open card when its kind gives the same key, folding plain calls and thoughts between them into a group after the card", () => {
        const grouped = fold([
          onNote("n1", "Plan"),
          action("read", { vendorToolName: "Read" }),
          reasoning(),
          onNote("n2", "Plan"),
        ]);

        expect(types(grouped)).toEqual(["toolCard", "activityGroup"]);
        expect(cardAt(grouped, 0)).toEqual({ kind: NOTE_CARD, ids: ["n1", "n2"] });
      });

      it("opens a new card for a call whose key differs from the open card's", () => {
        const grouped = fold([onNote("n1", "Plan"), onNote("n2", "Notes"), onNote("n3", "Plan")]);

        expect(types(grouped)).toEqual(["toolCard", "toolCard", "toolCard"]);
      });

      it("gives a call with no key its own card that no later call joins", () => {
        const grouped = fold([onNote("n1"), onNote("n2")]);

        expect(types(grouped)).toEqual(["toolCard", "toolCard"]);
      });

      it.each<[string, RenderNode]>([
        ["message", prose()],
        ["plan", { type: "plan", part: { kind: "plan", entries: [] } }],
        [
          "compaction",
          {
            type: "compaction",
            part: {
              kind: "compaction",
              id: "c1",
              status: "completed",
              trigger: "auto",
              startedAtMs: 0,
            },
          },
        ],
        [
          "sub-agent",
          { type: "subagent", parent: tool("t", { vendorToolName: "Task" }), children: [] },
        ],
        ["card of another kind", action("s1", { vendorToolName: "search_tool" })],
      ])(
        "ends the open card at a %s, so a later call with the same key opens a new card",
        (_, boundary) => {
          const grouped = fold([onNote("n1", "Plan"), boundary, onNote("n2", "Plan")]);

          expect(grouped).toHaveLength(3);
          expect(cardAt(grouped, 0).ids).toEqual(["n1"]);
          expect(cardAt(grouped, 2).ids).toEqual(["n2"]);
        }
      );

      it("puts a sub-agent whose launching call a kind claims into that kind's card", () => {
        const grouped = fold([
          {
            type: "subagent",
            parent: tool("t", { vendorToolName: "search_tool" }),
            children: [],
          },
        ]);

        expect(cardAt(grouped, 0)).toEqual({ kind: SEARCH_CARD, ids: ["t"] });
      });
    });

    describe("with Copilot's Excalidraw tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      const BOARD = "Boards/Launch board.excalidraw.md";
      const draw = (
        id: string,
        overrides: Partial<ToolCallPart> = {},
        path = BOARD
      ): RenderNode => ({
        type: "action",
        part: excalidrawToolCall(
          "excalidraw_write",
          { path, operations: [] },
          { id, ...overrides }
        ),
      });
      const render = (id: string): RenderNode => ({
        type: "action",
        part: excalidrawToolCall("excalidraw_render", { path: BOARD }, { id }),
      });
      const drawingAt = (nodes: GroupedTrailNode[], index: number) => {
        const node = nodes[index];
        if (node.type !== "toolCard") throw new Error(`node ${index} is ${node.type}`);
        return node.members.map((part) => part.id);
      };

      it("folds a write-render-fix loop on one drawing into one card, grouping the other tools after it", () => {
        const grouped = foldActivityGroups([
          action("grep", { vendorToolName: "Grep" }),
          draw("w1"),
          render("r1"),
          reasoning(),
          draw("w2", { status: "failed" }),
          action("read", { vendorToolName: "Read" }),
          draw("w3"),
          action("edit", { vendorToolName: "Edit" }),
          draw("w4"),
        ]);

        expect(types(grouped)).toEqual(["action", "toolCard", "activityGroup"]);
        expect(drawingAt(grouped, 1)).toEqual(["w1", "r1", "w2", "w3", "w4"]);
        expect(groupAt(grouped, 2).members.map((m) => m.type)).toEqual([
          "reasoning",
          "action",
          "action",
        ]);
      });

      it("opens the card with a failed first attempt so its retry joins it", () => {
        const grouped = foldActivityGroups([
          action("bash", { vendorToolName: "Bash" }),
          draw("w1", { status: "failed" }),
          draw("w2"),
        ]);

        expect(types(grouped)).toEqual(["action", "toolCard"]);
        expect(drawingAt(grouped, 1)).toEqual(["w1", "w2"]);
      });

      it("starts a new card after a message, so a later change never joins an earlier card", () => {
        const grouped = foldActivityGroups([draw("w1"), prose("Sheet 1 is in."), draw("w2")]);

        expect(types(grouped)).toEqual(["toolCard", "text", "toolCard"]);
      });

      it("gives each drawing its own card", () => {
        const grouped = foldActivityGroups([
          draw("w1"),
          draw("w2", {}, "Boards/Other.excalidraw.md"),
          draw("w3"),
        ]);

        expect(types(grouped)).toEqual(["toolCard", "toolCard", "toolCard"]);
      });

      it("gives each call whose drawing path is unknown its own card, since it may target a different drawing (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
        const unknown = (id: string): RenderNode => ({
          type: "action",
          part: excalidrawToolCall("excalidraw_write", { operations: [] }, { id }),
        });
        const grouped = foldActivityGroups([unknown("w1"), unknown("w2")]);

        expect(types(grouped)).toEqual(["toolCard", "toolCard"]);
      });

      it("opens a card for a render with no card to join, like any other Excalidraw call", () => {
        const grouped = foldActivityGroups([
          action("read", { vendorToolName: "Read" }),
          render("r1"),
          prose("The board looks right."),
        ]);

        expect(types(grouped)).toEqual(["action", "toolCard", "text"]);
      });
    });

    it("keeps a call that launched a session task out of the group, such as a background command (https://github.com/Brevilabs/obsidian-copilot-private/issues/749)", () => {
      const grouped = foldActivityGroups(
        [
          action("a", { vendorToolName: "Read" }),
          action("b", { vendorToolName: "Read" }),
          action("launch", { vendorToolName: "Bash" }),
          action("c", { vendorToolName: "Bash" }),
        ],
        { tasks: { tasks: [makeCommandTask({ toolCallId: "launch" })], openTask: jest.fn() } }
      );
      expect(types(grouped)).toEqual(["activityGroup", "toolCard", "action"]);
    });

    it("never folds a compaction row into a group and splits the groups around it", () => {
      const compaction: RenderNode = {
        type: "compaction",
        part: {
          kind: "compaction",
          id: "c1",
          status: "completed",
          trigger: "auto",
          startedAtMs: 0,
        },
      };
      const grouped = foldActivityGroups([
        action("a", { vendorToolName: "Read" }),
        action("b", { vendorToolName: "Bash" }),
        compaction,
        action("c", { vendorToolName: "Edit" }),
        action("d", { vendorToolName: "Bash" }),
      ]);

      expect(types(grouped)).toEqual(["activityGroup", "compaction", "activityGroup"]);
      expect(grouped[1]).toBe(compaction);
      expect(groupAt(grouped, 0).members).toHaveLength(2);
      expect(groupAt(grouped, 2).members).toHaveLength(2);
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

    it("keeps a submitted question answer visible beside agent tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", () => {
      const grouped = foldActivityGroups([
        action("shell", { vendorToolName: "Bash" }),
        action("answer", { userResponse: "Answered: Checklist" }),
        action("read", { vendorToolName: "Read" }),
      ]);
      expect(types(grouped)).toEqual(["action", "toolCard", "action"]);
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
        expect(types(grouped)).toEqual(["activityGroup", "toolCard", "activityGroup"]);
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
      expect(types(grouped)).toEqual(["activityGroup", "toolCard", "activityGroup"]);
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
      expect(line).toBe("Ran 3 commands, read 2 files");
    });

    it("uses one-file fallbacks when file tools omit paths (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Edit" }),
        member("b", { vendorToolName: "Write" }),
        member("c", { vendorToolName: "MultiEdit" }),
      ]);
      expect(line).toBe("Ran 3 commands, edited 3 files");
    });

    it("falls back to the ACP tool kind when there is no vendor name", () => {
      const { line } = summarizeActivity([
        member("a", { toolKind: "execute" }),
        member("b", { toolKind: "read" }),
      ]);
      expect(line).toBe("Ran 2 commands, read 1 file");
    });

    it("counts every grouped tool call as a command (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
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
      expect(line).toBe("Ran 3 commands, read 1 file");
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

    it("adds frozen reasoning spans to the active span (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const recorded: ActivityMember = {
        type: "reasoning",
        part: { kind: "thought", text: "first", durationMs: 12_648 },
      };
      const { line } = summarizeActivity(
        [member("a", { vendorToolName: "Bash" }), recorded, REASONING_MEMBER],
        { thinkingMs: 5_778 }
      );

      expect(line).toBe("Ran 1 command, thought for 18s");
    });

    it("counts structured diff paths and every tool call (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const { line } = summarizeActivity([
        member("python", { toolKind: "execute" }),
        member("edit", {
          toolKind: "edit",
          output: ["a.md", "b.md", "c.md", "d.md", "e.md"].map((path) => ({
            type: "diff" as const,
            path,
            oldText: "before",
            newText: "after",
          })),
        }),
        member("validate", { toolKind: "execute" }),
      ]);

      expect(line).toBe("Ran 3 commands, edited 5 files");
    });

    it("de-duplicates structured paths across file tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const { line } = summarizeActivity([
        member("a", { toolKind: "edit", locations: [{ path: "same.md" }] }),
        member("b", { toolKind: "edit", locations: [{ path: "same.md" }] }),
      ]);

      expect(line).toBe("Ran 2 commands, edited 1 file");
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

    it("does not claim a failed edit as an edited file (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const { line, failed } = summarizeActivity([
        member("a", { vendorToolName: "Edit", status: "failed", input: { file_path: "plan.md" } }),
        member("b", { vendorToolName: "Edit", input: { file_path: "todo.md" } }),
      ]);
      expect(line).toBe("Ran 2 commands, edited 1 file");
      expect(failed).toBe(1);
    });

    it("omits the edit phrase when every edit in the group failed (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      const { line } = summarizeActivity([
        member("a", { vendorToolName: "Read" }),
        member("b", { toolKind: "edit", status: "failed" }),
      ]);
      expect(line).toBe("Ran 2 commands, read 1 file");
    });

    it("does not count a stopped edit as an edited file or as a failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      const { line, failed } = summarizeActivity([
        member("a", {
          vendorToolName: "Edit",
          status: "cancelled",
          input: { file_path: "plan.md" },
        }),
        member("b", { vendorToolName: "Bash", status: "cancelled" }),
      ]);
      expect(line).toBe("Ran 2 commands");
      expect(failed).toBe(0);
    });

    it("reports no failures for a clean group", () => {
      expect(summarizeActivity([member("a", { vendorToolName: "Bash" })]).failed).toBe(0);
    });

    it("describes an empty group without producing an empty line", () => {
      expect(summarizeActivity([])).toEqual({ line: "Worked", failed: 0 });
    });
  });
});
