import type { PiUsage } from "@/pi/types";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { toSessionUsage, translatePiEvent, translatePiToolEvent } from "./piEventTranslate";

/** Minimal stand-in for the partial assistant message pi attaches to every delta. */
const PARTIAL = {} as never;

function messageUpdate(delta: unknown): AgentEvent {
  return {
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: delta,
  } as AgentEvent;
}

describe("piEventTranslate", () => {
  describe("translatePiEvent()", () => {
    it("turns assistant text deltas into message chunks", () => {
      const updates = translatePiEvent(
        messageUpdate({ type: "text_delta", contentIndex: 0, delta: "hello", partial: PARTIAL })
      );

      expect(updates).toEqual([
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      ]);
    });

    it("routes reasoning deltas to the thought channel so they render separately", () => {
      const updates = translatePiEvent(
        messageUpdate({ type: "thinking_delta", contentIndex: 0, delta: "hmm", partial: PARTIAL })
      );

      expect(updates).toEqual([
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
      ]);
    });

    it("emits nothing for deltas that carry no displayable text", () => {
      expect(
        translatePiEvent(messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }))
      ).toHaveLength(0);
      expect(
        translatePiEvent(
          messageUpdate({ type: "toolcall_delta", contentIndex: 0, delta: "{", partial: PARTIAL })
        )
      ).toHaveLength(0);
    });

    it("emits nothing for lifecycle events", () => {
      expect(translatePiEvent({ type: "turn_start" })).toHaveLength(0);
      expect(translatePiEvent({ type: "agent_start" })).toHaveLength(0);
    });

    it("returns the same frozen list for every event with no update", () => {
      const first = translatePiEvent({ type: "turn_start" });
      const second = translatePiEvent({ type: "agent_start" });

      expect(first).toBe(second);
    });
  });

  describe("translatePiToolEvent()", () => {
    it("opens an in-progress card carrying the tool's arguments", () => {
      const updates = translatePiToolEvent({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "search_vault",
        args: { query: "roadmap" },
      });

      expect(updates).toEqual([
        {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "Search vault",
          kind: "search",
          status: "in_progress",
          rawInput: { query: "roadmap" },
          vendorToolName: "search_vault",
        },
      ]);
    });

    it("settles the card as completed or failed when the tool returns", () => {
      const ok = translatePiToolEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "read_note",
        result: {},
        isError: false,
      });
      const failed = translatePiToolEvent({
        type: "tool_execution_end",
        toolCallId: "call-2",
        toolName: "web_search",
        result: {},
        isError: true,
      });

      expect(ok).toEqual([
        { sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" },
      ]);
      expect(failed).toEqual([
        { sessionUpdate: "tool_call_update", toolCallId: "call-2", status: "failed" },
      ]);
    });

    it("falls back to the raw name and a neutral kind for an unmapped tool", () => {
      const [update] = translatePiToolEvent({
        type: "tool_execution_start",
        toolCallId: "call-3",
        toolName: "future_tool",
        args: {},
      });

      expect(update).toMatchObject({ title: "future_tool", kind: "other" });
    });

    it("emits nothing for conversation events", () => {
      expect(
        translatePiToolEvent(
          messageUpdate({ type: "text_delta", contentIndex: 0, delta: "hi", partial: PARTIAL })
        )
      ).toHaveLength(0);
    });
  });

  describe("toSessionUsage()", () => {
    const usage: PiUsage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 60,
      cacheWriteTokens: 5,
      contextTokens: 185,
      contextWindow: 262144,
    };

    it("reports context occupancy and the cache split", () => {
      expect(toSessionUsage(usage, 1234)).toEqual({
        usedTokens: 185,
        contextWindow: 262144,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 60,
        cacheWriteTokens: 5,
        updatedAt: 1234,
      });
    });

    it("omits the window when the model reports none, so it stays count-only", () => {
      const snapshot = toSessionUsage({ ...usage, contextWindow: 0 }, 1);

      expect(snapshot).not.toHaveProperty("contextWindow");
      expect(snapshot.usedTokens).toBe(185);
    });
  });
});
