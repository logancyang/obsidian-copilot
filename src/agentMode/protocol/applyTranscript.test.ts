import { applyTranscriptOp } from "@/agentMode/protocol/applyTranscript";
import type { TranscriptOp } from "@/agentMode/protocol/ops";
import type { WireMessage, WireMessageContext } from "@/agentMode/protocol/state";
import { buildMessage, deepFreeze } from "@/agentMode/protocol/testBuilders";
import type { AgentMessagePart } from "@/agentMode/session/types";

type Op = TranscriptOp<WireMessageContext>;

const toolCall = (over: Partial<Extract<AgentMessagePart, { kind: "tool_call" }>> = {}) =>
  ({ kind: "tool_call", id: "t1", title: "Read", status: "pending", ...over }) as AgentMessagePart;

function replay(ops: Op[], start: readonly WireMessage[] = []): readonly WireMessage[] {
  return ops.reduce<readonly WireMessage[]>((state, op) => applyTranscriptOp(state, op), start);
}

describe("applyTranscript", () => {
  describe("applyTranscriptOp()", () => {
    it("msg.add appends the message the host built, keeping its id and timestamp", () => {
      const message = buildMessage({ id: "host-chosen", message: "hi" });
      const next = applyTranscriptOp([], { t: "msg.add", message });
      expect(next).toEqual([message]);
      expect(next[0]).toBe(message);
    });

    it("transcript.set replaces the whole transcript", () => {
      const replacement = [buildMessage({ id: "a" }), buildMessage({ id: "b" })];
      expect(
        applyTranscriptOp([buildMessage({ id: "old" })], {
          t: "transcript.set",
          messages: replacement,
        })
      ).toBe(replacement);
    });

    it("msg.appendText folds chunks into one trailing text part and mirrors them in the message body", () => {
      const next = replay(
        [
          { t: "msg.appendText", id: "m1", text: "Hello, ", atMs: 1 },
          { t: "msg.appendText", id: "m1", text: "world.", atMs: 2 },
        ],
        [buildMessage()]
      );
      expect(next[0].message).toBe("Hello, world.");
      expect(next[0].parts).toEqual([{ kind: "text", text: "Hello, world." }]);
    });

    it("msg.appendText starts a new text part after a tool call", () => {
      const next = replay(
        [
          { t: "msg.appendText", id: "m1", text: "before", atMs: 1 },
          { t: "msg.upsertPart", id: "m1", part: toolCall(), atMs: 2 },
          { t: "msg.appendText", id: "m1", text: "after", atMs: 3 },
        ],
        [buildMessage()]
      );
      expect(next[0].parts?.map((p) => p.kind)).toEqual(["text", "tool_call", "text"]);
    });

    it("msg.appendThought opens a thought span at the op clock and extends it while the turn runs", () => {
      const next = replay(
        [
          { t: "msg.appendThought", id: "m1", text: "a", atMs: 100 },
          { t: "msg.appendThought", id: "m1", text: "b", atMs: 200 },
        ],
        [buildMessage()]
      );
      expect(next[0].parts).toEqual([{ kind: "thought", text: "ab", startedAtMs: 100 }]);
    });

    it("msg.appendText freezes the trailing thought at the op clock", () => {
      const next = replay(
        [
          { t: "msg.appendThought", id: "m1", text: "hmm", atMs: 100 },
          { t: "msg.appendText", id: "m1", text: "answer", atMs: 460 },
        ],
        [buildMessage()]
      );
      expect(next[0].parts?.[0]).toEqual({
        kind: "thought",
        text: "hmm",
        startedAtMs: 100,
        durationMs: 360,
      });
    });

    it("msg.appendThought after the turn completed keeps a frozen span growing to the op clock (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const next = replay(
        [
          { t: "msg.turnComplete", id: "m1", stopReason: "end_turn", durationMs: 50, atMs: 50 },
          { t: "msg.appendThought", id: "m1", text: "lat", atMs: 300 },
          { t: "msg.appendThought", id: "m1", text: "er", atMs: 340 },
        ],
        [buildMessage()]
      );
      expect(next[0].parts).toEqual([
        { kind: "thought", text: "later", startedAtMs: 300, durationMs: 40 },
      ]);
    });

    it("msg.upsertPart replaces a tool call with the same id and keeps its position", () => {
      const start = [buildMessage({ parts: [toolCall(), { kind: "text", text: "x" }] })];
      const next = applyTranscriptOp(start, {
        t: "msg.upsertPart",
        id: "m1",
        part: toolCall({ status: "completed" }),
        atMs: 5,
      });
      expect(next[0].parts?.[0]).toMatchObject({ id: "t1", status: "completed" });
      expect(next[0].parts).toHaveLength(2);
    });

    it("msg.upsertPart returns the same transcript when the part is unchanged", () => {
      const start = [buildMessage({ parts: [toolCall()] })];
      expect(
        applyTranscriptOp(start, { t: "msg.upsertPart", id: "m1", part: toolCall(), atMs: 5 })
      ).toBe(start);
    });

    it("msg.upsertPart ends a trailing thought at the op clock when a plan snapshot replaces the plan part (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const plan: AgentMessagePart = { kind: "plan", entries: [] };
      const start = [
        buildMessage({ parts: [plan, { kind: "thought", text: "t", startedAtMs: 10 }] }),
      ];
      const next = applyTranscriptOp(start, {
        t: "msg.upsertPart",
        id: "m1",
        part: plan,
        atMs: 90,
      });
      expect(next[0].parts?.[1]).toEqual({
        kind: "thought",
        text: "t",
        startedAtMs: 10,
        durationMs: 80,
      });
    });

    it("msg.turnComplete records stop reason and clamps a negative duration to zero", () => {
      const next = applyTranscriptOp([buildMessage()], {
        t: "msg.turnComplete",
        id: "m1",
        stopReason: "cancelled",
        durationMs: -5,
        atMs: 1,
      });
      expect(next[0]).toMatchObject({ turnStopReason: "cancelled", turnDurationMs: 0 });
    });

    it("msg.turnComplete on an already completed turn changes nothing", () => {
      const start = [buildMessage({ turnStopReason: "end_turn", turnDurationMs: 10 })];
      expect(
        applyTranscriptOp(start, {
          t: "msg.turnComplete",
          id: "m1",
          stopReason: "cancelled",
          durationMs: 99,
          atMs: 1,
        })
      ).toBe(start);
    });

    it("msg.extendDuration only advances a completed turn", () => {
      const running = [buildMessage()];
      const done = [buildMessage({ turnStopReason: "end_turn", turnDurationMs: 10_000 })];
      expect(
        applyTranscriptOp(running, { t: "msg.extendDuration", id: "m1", durationMs: 15_000 })
      ).toBe(running);
      expect(
        applyTranscriptOp(done, { t: "msg.extendDuration", id: "m1", durationMs: 9_000 })
      ).toBe(done);
      expect(
        applyTranscriptOp(done, { t: "msg.extendDuration", id: "m1", durationMs: 15_000 })[0]
          .turnDurationMs
      ).toBe(15_000);
    });

    it("msg.setFanout stores the turn the host snapshotted", () => {
      const turn = { answers: {}, summary: { status: "pending" as const, text: "" } };
      expect(
        applyTranscriptOp([buildMessage()], { t: "msg.setFanout", id: "m1", turn })[0].fanout
      ).toBe(turn);
    });

    it("msg.markError appends an error block after existing text and flags the message", () => {
      const next = applyTranscriptOp([buildMessage({ message: "partial" })], {
        t: "msg.markError",
        id: "m1",
        errorText: "boom",
        durationMs: 30,
        atMs: 1,
      });
      expect(next[0]).toMatchObject({
        message: "partial\n\n**Error:** boom",
        isErrorMessage: true,
        turnDurationMs: 30,
      });
    });

    it("msg.markError on an empty message omits the blank-line separator", () => {
      const next = applyTranscriptOp([buildMessage()], {
        t: "msg.markError",
        id: "m1",
        errorText: "boom",
        atMs: 1,
      });
      expect(next[0].message).toBe("**Error:** boom");
    });

    it("ignores an op addressed to an unknown message and returns the same transcript", () => {
      const start = [buildMessage()];
      expect(
        applyTranscriptOp(start, { t: "msg.appendText", id: "nope", text: "x", atMs: 1 })
      ).toBe(start);
    });

    it("leaves untouched messages referentially stable so memoized rows do not re-render", () => {
      const start = [buildMessage({ id: "a" }), buildMessage({ id: "b" })];
      const next = applyTranscriptOp(start, { t: "msg.appendText", id: "b", text: "x", atMs: 1 });
      expect(next[0]).toBe(start[0]);
      expect(next[1]).not.toBe(start[1]);
    });

    it("never reads a clock or random source and never mutates its input", () => {
      const spies = [
        jest.spyOn(Date, "now").mockImplementation(() => {
          throw new Error("Date.now");
        }),
        jest.spyOn(Math, "random").mockImplementation(() => {
          throw new Error("Math.random");
        }),
        jest.spyOn(performance, "now").mockImplementation(() => {
          throw new Error("performance.now");
        }),
      ];
      try {
        const frozen = deepFreeze([buildMessage()]);
        const next = replay(
          [
            { t: "msg.appendThought", id: "m1", text: "t", atMs: 1 },
            { t: "msg.appendText", id: "m1", text: "x", atMs: 2 },
            { t: "msg.upsertPart", id: "m1", part: toolCall(), atMs: 3 },
            { t: "msg.markError", id: "m1", errorText: "e", atMs: 4 },
            { t: "msg.turnComplete", id: "m1", stopReason: "end_turn", durationMs: 4, atMs: 5 },
          ],
          frozen
        );
        expect(next[0].turnStopReason).toBe("end_turn");
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });
});
