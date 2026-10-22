import { AI_SENDER } from "@/constants";
import { AgentMessageStore } from "./AgentMessageStore";
import {
  compactionToPart,
  derivePlanTitleFromMarkdown,
  findToolCallPart,
  mergeToolCallUpdate,
  planToPart,
  toolCallToPart,
  tryReadExitPlanModeCall,
  upsertCompactionPart,
} from "./messageParts";
import type { AgentMessagePart } from "./types";

describe("messageParts", () => {
  describe("toolCallToPart()", () => {
    it("maps a tool call snapshot to a tool-call part with its text and diff outputs", () => {
      expect(
        toolCallToPart({
          toolCallId: "t1",
          title: "Edit note",
          kind: "edit",
          status: "in_progress",
          rawInput: { file_path: "a.md" },
          content: [
            { type: "content", content: { type: "text", text: "ok" } },
            { type: "diff", path: "a.md", newText: "new" },
          ],
          locations: [{ path: "a.md", line: null }],
          vendorToolName: "Edit",
          mcpServer: "copilot",
          parentToolCallId: "parent",
          progress: { toolUses: 2 },
        })
      ).toEqual({
        kind: "tool_call",
        id: "t1",
        title: "Edit note",
        toolKind: "edit",
        status: "in_progress",
        input: { file_path: "a.md" },
        output: [
          { type: "text", text: "ok" },
          { type: "diff", path: "a.md", oldText: null, newText: "new" },
        ],
        locations: [{ path: "a.md", line: undefined }],
        vendorToolName: "Edit",
        mcpServer: "copilot",
        parentToolCallId: "parent",
        progress: { toolUses: 2 },
      });
    });

    it("marks a call without a status as pending and leaves an empty output unset", () => {
      const part = toolCallToPart({ toolCallId: "t1", title: "Read", content: [] });

      expect(part).toMatchObject({ status: "pending", output: undefined });
    });

    it("trims a text output past 256,000 characters and says how much the display left out", () => {
      const part = toolCallToPart({
        toolCallId: "t1",
        title: "Read",
        content: [{ type: "content", content: { type: "text", text: "x".repeat(256_005) } }],
      });

      const text = part.kind === "tool_call" ? part.output?.[0] : undefined;
      expect(text).toEqual({
        type: "text",
        text:
          "x".repeat(256_000) +
          "\n\n[Display trimmed: 5 more characters. The agent received the full output.]",
      });
    });
  });

  describe("tryReadExitPlanModeCall()", () => {
    it("returns the plan body when isPlanProposal is true", () => {
      const out = tryReadExitPlanModeCall({
        kind: "other",
        rawInput: { plan: "# do the thing" },
        isPlanProposal: true,
      });
      expect(out).toEqual({ plan: "# do the thing", planFilePath: undefined });
    });

    it("falls back to ACP kind=switch_mode when isPlanProposal is unset", () => {
      const out = tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: "## plan body", planFilePath: "/abs/plan.md" },
      });
      expect(out).toEqual({ plan: "## plan body", planFilePath: "/abs/plan.md" });
    });

    it("returns null when rawInput.plan is missing — content gate is load-bearing", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "switch_mode",
          rawInput: { planFilePath: "/abs/plan.md" },
          isPlanProposal: true,
        })
      ).toBeNull();
    });

    it("returns null when rawInput.plan is not a string", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "switch_mode",
          rawInput: { plan: 42 },
        })
      ).toBeNull();
    });

    it("returns null when neither isPlanProposal nor switch_mode kind matches", () => {
      expect(
        tryReadExitPlanModeCall({
          kind: "edit",
          rawInput: { plan: "looks like a plan but isn't tagged as one" },
        })
      ).toBeNull();
    });

    it("ignores planFilePath when it isn't a string", () => {
      const out = tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: "body", planFilePath: 12 },
      });
      expect(out).toEqual({ plan: "body", planFilePath: undefined });
    });

    it("handles null/undefined rawInput without throwing", () => {
      expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: null })).toBeNull();
      expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: undefined })).toBeNull();
    });
  });
  describe("derivePlanTitleFromMarkdown()", () => {
    it("titles a plan with its first non-blank line, without heading marks", () => {
      expect(derivePlanTitleFromMarkdown("\n\n## Refactor the parser\n\n1. step")).toBe(
        "Refactor the parser"
      );
    });

    it("caps the title at 80 characters", () => {
      expect(derivePlanTitleFromMarkdown("y".repeat(100))).toBe("y".repeat(80));
    });

    it("falls back to a generic title for a blank plan", () => {
      expect(derivePlanTitleFromMarkdown("  \n\n")).toBe("Plan proposal");
    });
  });

  describe("mergeToolCallUpdate()", () => {
    const existing: AgentMessagePart = {
      kind: "tool_call",
      id: "t1",
      title: "Read",
      toolKind: "read",
      status: "pending",
      input: { path: "a.md" },
      output: [{ type: "text", text: "before" }],
      locations: [{ path: "a.md" }],
      progress: { toolUses: 1, durationMs: 10 },
    };

    it("overlays the fields an update reports and keeps the ones it omits", () => {
      expect(
        mergeToolCallUpdate(existing, {
          toolCallId: "t1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "after" } }],
          progress: { toolUses: 2 },
        })
      ).toEqual({
        ...existing,
        status: "completed",
        output: [{ type: "text", text: "after" }],
        progress: { toolUses: 2, durationMs: 10 },
      });
    });

    it("keeps the earlier output and locations when an update sends them as null", () => {
      const merged = mergeToolCallUpdate(existing, {
        toolCallId: "t1",
        content: null,
        locations: null,
      });

      expect(merged).toMatchObject({ output: existing.output, locations: existing.locations });
    });

    it("starts a pending tool-call part when the update's call has no part yet", () => {
      expect(mergeToolCallUpdate(undefined, { toolCallId: "t2", kind: "edit" })).toMatchObject({
        kind: "tool_call",
        id: "t2",
        title: "Tool call",
        toolKind: "edit",
        status: "pending",
      });
    });
  });

  describe("planToPart()", () => {
    it("maps plan entries to a plan part with their content, priority and status", () => {
      expect(
        planToPart({
          entries: [{ content: "step", priority: "high", status: "in_progress" }],
        })
      ).toEqual({
        kind: "plan",
        entries: [{ content: "step", priority: "high", status: "in_progress" }],
      });
    });
  });

  describe("compactionToPart()", () => {
    it("maps a compaction snapshot to a compaction part stamped with its start time", () => {
      expect(
        compactionToPart(
          {
            id: "c1",
            status: "completed",
            trigger: "manual",
            preTokens: 100,
            postTokens: 10,
          },
          1_000
        )
      ).toEqual({
        kind: "compaction",
        id: "c1",
        status: "completed",
        trigger: "manual",
        error: undefined,
        preTokens: 100,
        postTokens: 10,
        startedAtMs: 1_000,
      });
    });
  });

  describe("findToolCallPart()", () => {
    it("returns a message's tool-call part with the given id, and nothing for an unknown id", () => {
      const store = new AgentMessageStore();
      const part: AgentMessagePart = {
        kind: "tool_call",
        id: "t1",
        title: "Read",
        status: "pending",
      };
      const messageId = store.addMessage({
        message: "",
        sender: AI_SENDER,
        timestamp: null,
        isVisible: true,
        parts: [part],
      });

      expect(findToolCallPart(store, messageId, "t1")).toEqual(part);
      expect(findToolCallPart(store, messageId, "t2")).toBeUndefined();
    });
  });

  describe("upsertCompactionPart()", () => {
    it("adds a compaction part stamped now, then updates it in place keeping its start time", () => {
      jest.useFakeTimers({ now: 1_000 });
      try {
        const store = new AgentMessageStore();
        const messageId = store.addMessage({
          message: "",
          sender: AI_SENDER,
          timestamp: null,
          isVisible: true,
          parts: [],
        });

        expect(
          upsertCompactionPart(store, messageId, {
            id: "c1",
            status: "in_progress",
            trigger: "auto",
          })
        ).toBe(true);
        jest.setSystemTime(5_000);
        upsertCompactionPart(store, messageId, { id: "c1", status: "completed", trigger: "auto" });

        expect(store.getMessage(messageId)?.parts).toEqual([
          expect.objectContaining({ kind: "compaction", status: "completed", startedAtMs: 1_000 }),
        ]);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
