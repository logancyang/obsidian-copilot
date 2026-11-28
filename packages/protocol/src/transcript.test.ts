import type { AgentMessagePart, TranscriptMessage } from "@copilot/protocol/messages";
import { applyTranscriptOp, type TranscriptOp } from "@copilot/protocol/transcript";

interface LabelledMessage extends TranscriptMessage<{ paths: string[] }> {
  labels?: readonly string[];
}

type Op = TranscriptOp<LabelledMessage>;
type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

const message = (id: string, fields: Partial<LabelledMessage> = {}): LabelledMessage => ({
  id,
  message: "",
  sender: "ai",
  timestamp: null,
  isVisible: true,
  context: undefined,
  isErrorMessage: undefined,
  content: undefined,
  parts: [],
  turnStopReason: undefined,
  agentCancelCause: undefined,
  turnDurationMs: undefined,
  fileChanges: undefined,
  toolsUsed: undefined,
  labels: undefined,
  ...fields,
});

const toolCall = (id: string, fields: Partial<ToolCallPart> = {}): ToolCallPart => ({
  kind: "tool_call",
  id,
  title: `Run ${id}`,
  status: "pending",
  ...fields,
});

const thought = (text: string, startedAtMs: number, durationMs?: number): AgentMessagePart => ({
  kind: "thought",
  text,
  startedAtMs,
  ...(durationMs !== undefined ? { durationMs } : {}),
});

const apply = (messages: readonly LabelledMessage[], ...ops: Op[]): readonly LabelledMessage[] =>
  ops.reduce(applyTranscriptOp, messages);

const only = (messages: readonly LabelledMessage[]): LabelledMessage => {
  expect(messages).toHaveLength(1);
  return messages[0];
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const EVERY_OP_ON_REPLY: readonly Op[] = [
  { type: "appendThought", id: "reply", text: "Looking", atMs: 1_000 },
  { type: "upsertPart", id: "reply", part: toolCall("read"), atMs: 1_400 },
  { type: "upsertPart", id: "reply", part: toolCall("read", { status: "completed" }), atMs: 1_500 },
  { type: "upsertPart", id: "reply", part: toolCall("bash"), atMs: 1_600 },
  {
    type: "upsertPart",
    id: "reply",
    part: toolCall("task", { status: "in_progress" }),
    atMs: 1_650,
  },
  { type: "appendText", id: "reply", text: "Done", atMs: 1_700 },
  { type: "settleOpenParts", id: "reply", status: "failed" },
  { type: "stopToolCalls", id: "reply", keepToolCallIds: [] },
  { type: "markError", id: "reply", errorText: "Rate limited", durationMs: 900, atMs: 1_800 },
  { type: "completeTurn", id: "reply", stopReason: "end_turn", durationMs: 1_000, atMs: 1_900 },
  { type: "appendThought", id: "reply", text: " late", atMs: 2_000 },
  { type: "extendTurnDuration", id: "reply", durationMs: 1_500 },
  { type: "setCancelCause", id: "reply", cause: "unspecified" },
  { type: "setFileChanges", id: "reply", changes: [] },
  { type: "restoreSavedFields", rows: [{ id: "reply", fields: { toolsUsed: ["Read"] } }] },
  { type: "patchExtension", id: "reply", patch: { labels: ["kept"] } },
  { type: "remove", id: "reply" },
  { type: "add", message: message("next") },
  { type: "replaceAll", messages: [message("loaded")] },
];

describe("transcript", () => {
  describe("applyTranscriptOp()", () => {
    it("appends an added message after the existing ones", () => {
      const asked = message("asked", { sender: "user", message: "Hi" });
      const reply = message("reply");

      expect(apply([asked], { type: "add", message: reply })).toEqual([asked, reply]);
    });

    it("replaces the whole transcript with the messages a replaceAll carries", () => {
      const loaded = [message("loaded-0"), message("loaded-1")];

      expect(apply([message("old")], { type: "replaceAll", messages: loaded })).toBe(loaded);
    });

    it("removes the named message and keeps the others as they were", () => {
      const asked = message("asked");
      const reply = message("reply");

      const next = apply([asked, reply], { type: "remove", id: "reply" });

      expect(next).toEqual([asked]);
      expect(next[0]).toBe(asked);
    });

    it("appends streamed text to the message text and to its trailing text part", () => {
      const next = apply(
        [message("reply")],
        { type: "appendText", id: "reply", text: "Hello, ", atMs: 10 },
        { type: "appendText", id: "reply", text: "world.", atMs: 20 }
      );

      expect(only(next).message).toBe("Hello, world.");
      expect(only(next).parts).toEqual([{ kind: "text", text: "Hello, world." }]);
    });

    it("starts a new text part when text follows a tool call", () => {
      const next = apply(
        [message("reply", { message: "Before", parts: [{ kind: "text", text: "Before" }] })],
        { type: "upsertPart", id: "reply", part: toolCall("read"), atMs: 10 },
        { type: "appendText", id: "reply", text: "After", atMs: 20 }
      );

      expect(only(next).parts?.map((part) => part.kind)).toEqual(["text", "tool_call", "text"]);
      expect(only(next).message).toBe("BeforeAfter");
    });

    it("gives a message without parts its first text part", () => {
      const next = apply([message("reply", { parts: undefined })], {
        type: "appendText",
        id: "reply",
        text: "Hi",
        atMs: 10,
      });

      expect(only(next).parts).toEqual([{ kind: "text", text: "Hi" }]);
    });

    it("folds thought chunks into one part that started at the first chunk's time (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const next = apply(
        [message("reply")],
        { type: "appendThought", id: "reply", text: "Reading ", atMs: 1_000 },
        { type: "appendThought", id: "reply", text: "the plan", atMs: 1_300 }
      );

      expect(only(next).parts).toEqual([thought("Reading the plan", 1_000)]);
    });

    it("ends a running thought at the time of the text, tool call or plan that follows it (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const running = [message("reply", { parts: [thought("Thinking", 1_000)] })];

      const afterText = apply(running, { type: "appendText", id: "reply", text: "A", atMs: 1_250 });
      const afterTool = apply(running, {
        type: "upsertPart",
        id: "reply",
        part: toolCall("read"),
        atMs: 1_400,
      });

      expect(only(afterText).parts?.[0]).toEqual(thought("Thinking", 1_000, 250));
      expect(only(afterTool).parts?.[0]).toEqual(thought("Thinking", 1_000, 400));
    });

    it("starts a new timed thought after an ended one (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const next = apply([message("reply", { parts: [thought("First", 1_000, 200)] })], {
        type: "appendThought",
        id: "reply",
        text: "Second",
        atMs: 2_000,
      });

      expect(only(next).parts).toEqual([thought("First", 1_000, 200), thought("Second", 2_000)]);
    });

    it("extends a completed message's trailing thought to the late chunk's time (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const completed = message("reply", {
        parts: [thought("Almost", 1_000, 300)],
        turnStopReason: "end_turn",
      });

      const next = apply([completed], {
        type: "appendThought",
        id: "reply",
        text: " done",
        atMs: 1_900,
      });

      expect(only(next).parts).toEqual([thought("Almost done", 1_000, 900)]);
    });

    it("starts a frozen thought when a late chunk follows a completed message's text (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const completed = message("reply", {
        message: "Answer",
        parts: [{ kind: "text", text: "Answer" }],
        turnStopReason: "end_turn",
      });

      const next = apply([completed], {
        type: "appendThought",
        id: "reply",
        text: "Late",
        atMs: 3_000,
      });

      expect(only(next).parts?.[1]).toEqual(thought("Late", 3_000, 0));
    });

    it("lets completed text extend a completed message's trailing thought to the text's time (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const completed = message("reply", {
        parts: [thought("Late", 1_000, 0)],
        turnStopReason: "end_turn",
      });

      const next = apply([completed], { type: "appendText", id: "reply", text: "A", atMs: 1_700 });

      expect(only(next).parts?.[0]).toEqual(thought("Late", 1_000, 700));
    });

    it("appends a new tool call and replaces it by its id as it updates", () => {
      const next = apply(
        [message("reply")],
        { type: "upsertPart", id: "reply", part: toolCall("read"), atMs: 10 },
        { type: "upsertPart", id: "reply", part: toolCall("bash"), atMs: 20 },
        {
          type: "upsertPart",
          id: "reply",
          part: toolCall("read", { status: "completed" }),
          atMs: 30,
        }
      );

      expect(only(next).parts).toEqual([
        toolCall("read", { status: "completed" }),
        toolCall("bash"),
      ]);
    });

    it("returns the same transcript when a tool call update repeats what the call already holds", () => {
      const state = apply([message("reply")], {
        type: "upsertPart",
        id: "reply",
        part: toolCall("read", {
          progress: { toolUses: 2 },
          output: [{ type: "text", text: "x" }],
        }),
        atMs: 10,
      });

      const next = apply(state, {
        type: "upsertPart",
        id: "reply",
        part: toolCall("read", {
          progress: { toolUses: 2 },
          output: [{ type: "text", text: "x" }],
        }),
        atMs: 20,
      });

      expect(next).toBe(state);
    });

    it("keeps one plan per message, replacing it with each new snapshot", () => {
      const plan = (status: "pending" | "completed"): AgentMessagePart => ({
        kind: "plan",
        entries: [{ content: "Write the step", priority: "high", status }],
      });

      const next = apply(
        [message("reply")],
        { type: "upsertPart", id: "reply", part: plan("pending"), atMs: 10 },
        { type: "upsertPart", id: "reply", part: plan("completed"), atMs: 20 }
      );

      expect(only(next).parts).toEqual([plan("completed")]);
    });

    it("lets an unchanged plan snapshot still end a running thought after it (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const plan: AgentMessagePart = {
        kind: "plan",
        entries: [{ content: "Write", priority: "low", status: "pending" }],
      };
      const state = [message("reply", { parts: [plan, thought("Next", 1_000)] })];

      const next = apply(state, {
        type: "upsertPart",
        id: "reply",
        part: { ...plan },
        atMs: 1_600,
      });

      expect(only(next).parts).toEqual([plan, thought("Next", 1_000, 600)]);
    });

    it("keeps compaction rows with different ids apart and replaces a row by its id", () => {
      const compaction = (id: string, status: "in_progress" | "completed"): AgentMessagePart => ({
        kind: "compaction",
        id,
        status,
        trigger: "manual",
        startedAtMs: 5,
      });

      const next = apply(
        [message("reply")],
        { type: "upsertPart", id: "reply", part: compaction("c1", "in_progress"), atMs: 10 },
        { type: "upsertPart", id: "reply", part: compaction("c2", "in_progress"), atMs: 20 },
        { type: "upsertPart", id: "reply", part: compaction("c1", "completed"), atMs: 30 }
      );

      expect(only(next).parts).toEqual([
        compaction("c1", "completed"),
        compaction("c2", "in_progress"),
      ]);
    });

    it("completes a turn with its stop reason and duration and ends its trailing thought at the op's time (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const next = apply([message("reply", { parts: [thought("Hmm", 1_000)] })], {
        type: "completeTurn",
        id: "reply",
        stopReason: "end_turn",
        durationMs: 4_200,
        atMs: 1_800,
      });

      expect(only(next)).toMatchObject({
        turnStopReason: "end_turn",
        turnDurationMs: 4_200,
        parts: [thought("Hmm", 1_000, 800)],
      });
    });

    it("leaves an already completed turn as it was and floors a negative duration at zero", () => {
      const completed = apply([message("reply")], {
        type: "completeTurn",
        id: "reply",
        stopReason: "cancelled",
        durationMs: -5,
        atMs: 10,
      });

      const again = apply(completed, {
        type: "completeTurn",
        id: "reply",
        stopReason: "end_turn",
        durationMs: 99,
        atMs: 20,
      });

      expect(only(completed)).toMatchObject({ turnStopReason: "cancelled", turnDurationMs: 0 });
      expect(again).toBe(completed);
    });

    it("extends only a completed turn's duration, and only forward", () => {
      const open = [message("reply")];
      const completed = [message("reply", { turnDurationMs: 1_000 })];

      expect(apply(open, { type: "extendTurnDuration", id: "reply", durationMs: 5_000 })).toBe(
        open
      );
      expect(apply(completed, { type: "extendTurnDuration", id: "reply", durationMs: 900 })).toBe(
        completed
      );
      expect(
        only(apply(completed, { type: "extendTurnDuration", id: "reply", durationMs: 1_500 }))
          .turnDurationMs
      ).toBe(1_500);
    });

    it("marks a message as an error, appends the error under its text and ends its thought (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      const partial = message("reply", {
        message: "Partial",
        parts: [{ kind: "text", text: "Partial" }, thought("Then", 1_000)],
      });

      const next = apply([partial], {
        type: "markError",
        id: "reply",
        errorText: "Rate limited",
        durationMs: 2_000,
        atMs: 1_300,
      });

      expect(only(next)).toMatchObject({
        isErrorMessage: true,
        message: "Partial\n\n**Error:** Rate limited",
        turnDurationMs: 2_000,
        parts: [{ kind: "text", text: "Partial" }, thought("Then", 1_000, 300)],
      });
    });

    it("writes an empty message's error without a leading blank line and keeps its duration when the op has none", () => {
      const next = apply([message("reply", { turnDurationMs: 700 })], {
        type: "markError",
        id: "reply",
        errorText: "Offline",
        atMs: 10,
      });

      expect(only(next)).toMatchObject({ message: "**Error:** Offline", turnDurationMs: 700 });
    });

    it("settles open parts: running compactions take the given status, pending tool calls fail, and running or finished ones stay (https://github.com/Brevilabs/obsidian-copilot-private/issues/633, https://github.com/Brevilabs/obsidian-copilot-private/issues/739)", () => {
      const compaction: AgentMessagePart = {
        kind: "compaction",
        id: "c1",
        status: "in_progress",
        trigger: "auto",
        startedAtMs: 1,
      };
      const state = [
        message("reply", {
          parts: [
            compaction,
            toolCall("pending"),
            toolCall("running", { status: "in_progress" }),
            toolCall("done", { status: "completed" }),
          ],
        }),
      ];

      const next = apply(state, { type: "settleOpenParts", id: "reply", status: "cancelled" });

      expect(only(next).parts).toEqual([
        { ...compaction, status: "cancelled" },
        toolCall("pending", { status: "failed" }),
        toolCall("running", { status: "in_progress" }),
        toolCall("done", { status: "completed" }),
      ]);
    });

    it("returns the same transcript when a message has no open part to settle", () => {
      const state = [message("reply", { parts: [toolCall("done", { status: "completed" })] })];

      expect(apply(state, { type: "settleOpenParts", id: "reply", status: "failed" })).toBe(state);
    });

    it("stops pending and running tool calls except the kept ones (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      const state = [
        message("reply", {
          parts: [
            toolCall("pending"),
            toolCall("running", { status: "in_progress" }),
            toolCall("background", { status: "in_progress" }),
            toolCall("done", { status: "completed" }),
          ],
        }),
      ];

      const next = apply(state, {
        type: "stopToolCalls",
        id: "reply",
        keepToolCallIds: ["background"],
      });
      const again = apply(next, {
        type: "stopToolCalls",
        id: "reply",
        keepToolCallIds: ["background"],
      });

      expect(only(next).parts).toEqual([
        toolCall("pending", { status: "cancelled" }),
        toolCall("running", { status: "cancelled" }),
        toolCall("background", { status: "in_progress" }),
        toolCall("done", { status: "completed" }),
      ]);
      expect(again).toBe(next);
    });

    it("records the cause the op gives for an agent's cancellation", () => {
      const next = apply([message("reply")], {
        type: "setCancelCause",
        id: "reply",
        cause: "permission_declined",
      });

      expect(only(next).agentCancelCause).toBe("permission_declined");
    });

    it("replaces a message's file changes with the op's list", () => {
      const change = {
        path: "a.md",
        status: "created" as const,
        before: null,
        after: "x",
        additions: 1,
        deletions: 0,
      };

      const next = apply([message("reply", { fileChanges: [{ ...change, path: "old.md" }] })], {
        type: "setFileChanges",
        id: "reply",
        changes: [change],
      });

      expect(only(next).fileChanges).toEqual([change]);
    });

    it("restores each saved row's fields onto the message it names and leaves the others alone", () => {
      const asked = message("asked", { sender: "user", message: "Hi" });
      const reply = message("reply", { message: "Hello" });
      const savedAt = { epoch: 5, display: "2026/01/01 12:00:00", fileName: "20260101_120000" };

      const next = apply([asked, reply], {
        type: "restoreSavedFields",
        rows: [
          {
            id: "asked",
            fields: {
              timestamp: savedAt,
              message: "Hi\n\n![](a.png)",
              context: { paths: ["a.md"] },
              labels: ["saved"],
            },
          },
        ],
      });

      expect(next[0]).toEqual({
        ...asked,
        timestamp: savedAt,
        message: "Hi\n\n![](a.png)",
        context: { paths: ["a.md"] },
        labels: ["saved"],
      });
      expect(next[1]).toBe(reply);
    });

    it("returns the same transcript when no saved row is restored", () => {
      const state = [message("reply")];

      expect(apply(state, { type: "restoreSavedFields", rows: [] })).toBe(state);
    });

    it("patches a message's extension fields and leaves its core fields as they were", () => {
      const reply = message("reply", { message: "Hello", labels: ["old"] });

      const next = apply([reply], {
        type: "patchExtension",
        id: "reply",
        patch: { labels: ["new"] },
      });

      expect(only(next)).toEqual({ ...reply, labels: ["new"] });
    });

    it("returns the same transcript for every op that names a message it does not hold", () => {
      const state = [message("other")];

      for (const op of EVERY_OP_ON_REPLY) {
        if (op.type === "add" || op.type === "replaceAll") continue;
        expect(applyTranscriptOp(state, op)).toBe(state);
      }
    });

    it("copies only the changed message and part, so the other messages and the earlier parts keep their identity", () => {
      const earlier = message("earlier", { message: "Done" });
      const firstPart = toolCall("read", { status: "completed" });
      const streaming = message("streaming", {
        parts: [firstPart, { kind: "text", text: "Hel" }],
      });

      const next = apply([earlier, streaming], {
        type: "appendText",
        id: "streaming",
        text: "lo",
        atMs: 10,
      });

      expect(next[0]).toBe(earlier);
      expect(next[1]).not.toBe(streaming);
      expect(next[1].parts?.[0]).toBe(firstPart);
      expect(next[1].parts?.[1]).toEqual({ kind: "text", text: "Hello" });
    });

    it("never changes the transcript or op it is given", () => {
      let state: readonly LabelledMessage[] = deepFreeze([message("reply")]);

      for (const op of EVERY_OP_ON_REPLY) {
        state = deepFreeze(applyTranscriptOp(state, deepFreeze(op)));
      }

      expect(state).toEqual([message("loaded")]);
    });

    it("never reads a clock, a random source or crypto, so replaying the same ops gives the same transcript", () => {
      const RealDate = Date;
      const forbidden = (): never => {
        throw new Error("the transcript reducer read a clock or random source");
      };
      class ClockFreeDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) forbidden();
          super(...(args as [number]));
        }
        static now = forbidden;
      }
      const random = jest.spyOn(Math, "random").mockImplementation(forbidden);
      const realCrypto = window.crypto;
      window.Date = ClockFreeDate as unknown as DateConstructor;
      Object.defineProperty(window, "crypto", {
        configurable: true,
        get: forbidden,
      });
      try {
        const replays = [0, 1].map(() =>
          apply([message("reply")], ...EVERY_OP_ON_REPLY.slice(0, -3))
        );

        expect(replays[0]).toEqual(replays[1]);
      } finally {
        window.Date = RealDate;
        Object.defineProperty(window, "crypto", {
          configurable: true,
          writable: true,
          value: realCrypto,
        });
        random.mockRestore();
      }
    });
  });
});
