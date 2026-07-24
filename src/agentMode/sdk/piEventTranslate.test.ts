import type { PiUsage } from "@/pi/types";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { toSessionUsage, translatePiEvent } from "./piEventTranslate";

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
