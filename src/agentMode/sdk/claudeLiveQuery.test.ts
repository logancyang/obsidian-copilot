import fs from "fs";
import path from "path";
import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionUpdate } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: false } }),
}));
jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: () => "",
}));

import { CLAUDE_DISCONNECTED_MESSAGE, ClaudeLiveQuery } from "./claudeLiveQuery";
import { createTranslatorState } from "./sdkMessageTranslator";
import { SDK_STREAM_STALL_MESSAGE } from "./sdkStreamStallGuard";
import {
  commandLifecycle,
  FakeClaudeQuery,
  SessionEventRecorder,
  resultFrame,
  systemInit,
  textDelta,
  userEcho,
} from "./testing/fakeClaudeQuery";

const SESSION_ID = "session-live";

interface FixtureFrame {
  tag: string;
  payload: SDKMessage;
}

function readSdkFixture(name: string): FixtureFrame[] {
  return fs
    .readFileSync(path.join(__dirname, "__fixtures__", `${name}.ndjson`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FixtureFrame);
}
const ISSUE_175 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/175";
const ISSUE_195 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/195";
const ISSUE_747 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/747";

interface Harness {
  live: ClaudeLiveQuery;
  fake: FakeClaudeQuery;
  recorder: SessionEventRecorder;
  ended: Promise<void>;
  onSignedOut: jest.Mock;
}

function startLive(stallTimeoutMs?: number): Harness {
  const recorder = new SessionEventRecorder();
  const onSignedOut = jest.fn();
  let fake!: FakeClaudeQuery;
  let markEnded!: () => void;
  const ended = new Promise<void>((resolve) => (markEnded = resolve));
  const live = new ClaudeLiveQuery({
    sessionId: SESSION_ID,
    start: (input: AsyncIterable<SDKUserMessage>) => {
      fake = new FakeClaudeQuery(input);
      return fake as unknown as Query;
    },
    translator: createTranslatorState(),
    emit: recorder.handler,
    onTurnStarted: jest.fn(),
    onSignedOut,
    onEnded: markEnded,
    stallTimeoutMs,
  });
  return { live, fake, recorder, ended, onSignedOut };
}

function lifecycle(updates: SessionUpdate[]): string[] {
  return updates.flatMap((update) => {
    switch (update.sessionUpdate) {
      case "message_delivered":
        return [`delivered ${update.promptId}`];
      case "turn_started":
        return ["turn_started"];
      case "turn_ended":
        return [update.error ? `turn_ended error: ${update.error.message}` : "turn_ended"];
      case "messages_withdrawn":
        return [`withdrawn ${update.promptIds.join(",")}`];
      case "session_disconnected":
        return [`disconnected: ${update.error.message}`];
      case "task_started":
        return [`task_started ${update.taskId ?? `launch ${update.toolCallId}`}`];
      case "task_ended":
        return [`task_ended ${update.taskId} ${update.status}`];
      default:
        return [];
    }
  });
}

function taskFrame(subtype: string, fields: Record<string, unknown>): SDKMessage {
  return {
    type: "system",
    subtype,
    task_id: "task-1",
    description: "Count words",
    session_id: SESSION_ID,
    uuid: `uuid-${subtype}`,
    ...fields,
  } as unknown as SDKMessage;
}

function replyText(updates: SessionUpdate[]): string {
  return updates
    .map((update) =>
      update.sessionUpdate === "agent_message_chunk" && update.content.type === "text"
        ? update.content.text
        : ""
    )
    .join("");
}

describe("claudeLiveQuery", () => {
  describe("ClaudeLiveQuery", () => {
    describe("push()", () => {
      it("sends each prompt as a user message whose uuid is the prompt id, on the one open query", async () => {
        const { live, fake } = startLive();

        live.push("prompt-1", "first");
        live.push("prompt-2", [{ type: "text", text: "second" }]);

        expect(await fake.nextInput(1)).toEqual({
          type: "user",
          uuid: "prompt-2",
          session_id: "",
          parent_tool_use_id: null,
          message: { role: "user", content: [{ type: "text", text: "second" }] },
        });
        expect(fake.inputs.map((input) => input.uuid)).toEqual(["prompt-1", "prompt-2"]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 sends an interrupt-and-send prompt at priority now, so Claude ends the running turn at its next safe point and runs it", async () => {
        const { live, fake } = startLive();

        live.push("steer", "keep going");
        live.push("urgent", "do this instead", true);

        expect((await fake.nextInput(0)).priority).toBeUndefined();
        expect((await fake.nextInput(1)).priority).toBe("now");
      });

      it(`reports a prompt delivered when Claude echoes it and starts its turn there, without rendering the echo (${ISSUE_175})`, async () => {
        const { live, fake, recorder } = startLive();

        live.push("prompt-1", "hi");
        fake.echo(await fake.nextInput());
        fake.emit(textDelta("hello"), resultFrame());
        await recorder.waitFor("turn_ended");

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "turn_ended",
        ]);
        expect(recorder.updates().some((u) => u.sessionUpdate === "user_message_chunk")).toBe(
          false
        );
        expect(replyText(recorder.updates())).toBe("hello");
      });

      it(`ignores an echo of input Copilot did not send, such as a task notification folded into a turn (${ISSUE_175})`, async () => {
        const { live, fake, recorder } = startLive();

        live.push("prompt-1", "hi");
        fake.echo(await fake.nextInput());
        fake.emit(userEcho("cli-notification", "<task-notification>…</task-notification>"));
        fake.emit(resultFrame());
        await recorder.waitFor("turn_ended");

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "turn_ended",
        ]);
      });
    });

    describe("constructor()", () => {
      it(`withdraws a prompt Claude reports cancelled without running it, such as one Stop withdrew before Claude was ready, and ignores the frame for a delivered prompt (${ISSUE_747})`, async () => {
        const { live, fake, recorder } = startLive();
        live.push("prompt-1", "first");
        live.push("prompt-2", "second");
        fake.echo(await fake.nextInput(0));
        await recorder.waitFor("message_delivered");

        fake.emit(
          commandLifecycle("prompt-1", "cancelled"),
          commandLifecycle("prompt-2", "queued"),
          commandLifecycle("prompt-2", "cancelled")
        );
        await recorder.waitFor("messages_withdrawn");

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "withdrawn prompt-2",
        ]);
      });

      it(`runs a recorded background subagent session as three turns: the launch, an unrelated prompt, and the agent's own reply once the subagent ends (${ISSUE_175})`, async () => {
        const frames = readSdkFixture("claude-live-background-agent");
        const echoes = frames.filter((frame) => frame.tag === "user:echo");
        const { live, fake, recorder } = startLive();

        live.push(echoes[0].payload.uuid!, "launch");
        live.push(echoes[1].payload.uuid!, "unrelated");
        fake.emit(...frames.map((frame) => frame.payload));
        await recorder.waitFor("turn_ended", () => true, 2);

        expect(lifecycle(recorder.updates())).toEqual([
          `delivered ${echoes[0].payload.uuid}`,
          "turn_started",
          "task_started launch toolu_01RcE2APQiNj6mPLBCvi47oY",
          "task_started launch toolu_01RcE2APQiNj6mPLBCvi47oY",
          "task_started af1943f5abdca8b57",
          "turn_ended",
          `delivered ${echoes[1].payload.uuid}`,
          "turn_started",
          "turn_ended",
          "task_ended af1943f5abdca8b57 completed",
          "turn_started",
          "turn_ended",
        ]);
      });

      it(`routes a subagent's content to its task by the tool call that launched it, never to a main-agent reply (${ISSUE_175})`, async () => {
        const frames = readSdkFixture("claude-live-background-agent");
        const echoes = frames.filter((frame) => frame.tag === "user:echo");
        const { live, fake, recorder } = startLive();

        live.push(echoes[0].payload.uuid!, "launch");
        live.push(echoes[1].payload.uuid!, "unrelated");
        fake.emit(...frames.map((frame) => frame.payload));
        await recorder.waitFor("turn_ended", () => true, 2);

        const subagentEvents = recorder.events.filter((event) => event.taskToolCallId);
        const mainText = replyText(
          recorder.events.filter((event) => !event.taskToolCallId).map((event) => event.update)
        );
        expect(new Set(subagentEvents.map((event) => event.taskToolCallId))).toEqual(
          new Set(["toolu_01RcE2APQiNj6mPLBCvi47oY"])
        );
        expect(replyText(subagentEvents.map((event) => event.update))).toContain("13 total");
        expect(mainText).not.toContain("`wc -w` printed");
        expect(recorder.updates()).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_started",
            taskId: "af1943f5abdca8b57",
            toolCallId: "toolu_01RcE2APQiNj6mPLBCvi47oY",
            kind: "subagent",
          })
        );
      });

      it(`opens no turn for a task-notification result with no content, so the prompt that follows gets the one reply (${ISSUE_195})`, async () => {
        const frames = readSdkFixture("claude-live-resumed-orphan");
        const echo = frames.find((frame) => frame.tag === "user:echo")!;
        const { live, fake, recorder } = startLive();

        live.push(echo.payload.uuid!, "Reply with only: RESUMED.");
        fake.emit(...frames.map((frame) => frame.payload));
        await recorder.waitFor("turn_ended");

        expect(lifecycle(recorder.updates())).toEqual([
          `delivered ${echo.payload.uuid}`,
          "turn_started",
          "turn_ended",
        ]);
        expect(replyText(recorder.updates())).toBe("RESUMED.");
      });

      it(`ends the turn of a prompt stopped before Claude checked it, which gets a result naming it but no echo (${ISSUE_175})`, async () => {
        const { live, fake, recorder } = startLive();

        live.push("prompt-1", "hi");
        await fake.nextInput();
        fake.emit(
          resultFrame({
            subtype: "error_during_execution",
            is_error: true,
            num_turns: 0,
            errors: ["prompt_check: the turn was stopped before its prompt was checked"],
            user_message_uuids: ["prompt-1"],
          })
        );
        await recorder.waitFor("turn_ended");

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "turn_ended error: prompt_check: the turn was stopped before its prompt was checked",
        ]);
      });

      it(`delivers an echoed prompt once when its result names it again, and keeps a prompt the result does not name waiting for its own turn (${ISSUE_175})`, async () => {
        const { live, fake, recorder } = startLive();

        live.push("prompt-1", "first");
        live.push("prompt-2", "second");
        fake.echo(await fake.nextInput(0));
        fake.emit(textDelta("one"), resultFrame({ user_message_uuids: ["prompt-1"] }));
        await recorder.waitFor("turn_ended");
        fake.echo(await fake.nextInput(1));
        fake.emit(textDelta("two"), resultFrame({ user_message_uuids: ["prompt-2"] }));
        await recorder.waitFor("turn_ended", () => true, 1);

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "turn_ended",
          "delivered prompt-2",
          "turn_started",
          "turn_ended",
        ]);
      });

      it(`starts a turn the agent begins on its own at its first main-agent content (${ISSUE_175})`, async () => {
        const { fake, recorder } = startLive();

        fake.emit(textDelta("A subagent finished."), resultFrame());
        await recorder.waitFor("turn_ended");

        expect(lifecycle(recorder.updates())).toEqual(["turn_started", "turn_ended"]);
      });

      it(`dates a turn the agent begins on its own from Claude's turn announcement, not from its first output (${ISSUE_175})`, async () => {
        const now = jest.spyOn(Date, "now");
        try {
          const { fake, recorder } = startLive();
          now.mockReturnValueOnce(1_000).mockReturnValue(9_000);
          fake.emit(systemInit(), textDelta("A subagent finished."), resultFrame());
          const started = await recorder.waitFor("turn_started");

          expect(started.startedAt).toBe(1_000);
        } finally {
          now.mockRestore();
        }
      });

      it("ends the turn with Claude's message when a success-shaped result reports an error", async () => {
        const { live, fake, recorder } = startLive();

        live.push("prompt-1", "hi");
        fake.echo(await fake.nextInput());
        fake.emit(resultFrame({ is_error: true, result: "You've hit your session limit" }));
        const end = await recorder.waitFor("turn_ended");

        expect(end.error).toEqual(new Error("You've hit your session limit"));
      });

      it("reports a sign-out when a turn fails without naming an error", async () => {
        const { live, fake, recorder, onSignedOut } = startLive();

        live.push("prompt-1", "hi");
        fake.echo(await fake.nextInput());
        fake.emit(resultFrame({ subtype: "error_during_execution", is_error: true, errors: [] }));
        const end = await recorder.waitFor("turn_ended");

        expect(end).toMatchObject({ stopReason: "cancelled" });
        expect(onSignedOut).toHaveBeenCalledTimes(1);
      });

      it(`when Claude exits unexpectedly, ends the open turn, withdraws undelivered prompts, stops running tasks, then reports the disconnect, in that order (${ISSUE_175})`, async () => {
        const { live, fake, recorder, ended } = startLive();

        live.push("prompt-1", "first");
        fake.echo(await fake.nextInput());
        fake.emit(textDelta("partial"));
        fake.emit({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "toolu_agent",
          description: "Count words",
          task_type: "local_agent",
          is_backgrounded: true,
        } as unknown as SDKMessage);
        live.push("prompt-2", "second");
        await fake.nextInput(1);
        fake.end();
        await ended;

        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "task_started task-1",
          `turn_ended error: ${CLAUDE_DISCONNECTED_MESSAGE}`,
          "withdrawn prompt-2",
          "task_ended task-1 stopped",
          `disconnected: ${CLAUDE_DISCONNECTED_MESSAGE}`,
        ]);
      });

      it(`reports the stream's own error when the query throws (${ISSUE_175})`, async () => {
        const { fake, recorder, ended } = startLive();

        fake.fail(new Error("process exited with code 1"));
        await ended;

        expect(lifecycle(recorder.updates())).toEqual(["disconnected: process exited with code 1"]);
      });

      it(`ends a stalled turn with the stall error, interrupts it, and stays connected when Claude answers the interrupt (${ISSUE_175})`, async () => {
        jest.useFakeTimers();
        try {
          const { live, fake, recorder } = startLive(1_000);
          live.push("prompt-1", "hi");
          fake.echo(await fake.nextInput());
          fake.emit(textDelta("half a sent"));
          await recorder.waitFor("agent_message_chunk");

          jest.advanceTimersByTime(1_000);
          const end = await recorder.waitFor("turn_ended");
          fake.emit(resultFrame({ subtype: "error_during_execution", errors: ["interrupted"] }));
          live.push("prompt-2", "again");
          fake.echo(await fake.nextInput(1));
          await recorder.waitFor("message_delivered", (u) => u.promptId === "prompt-2");
          jest.advanceTimersByTime(5_000);

          expect(end.error).toEqual(new Error(SDK_STREAM_STALL_MESSAGE));
          expect(fake.interrupt).toHaveBeenCalledTimes(1);
          expect(fake.close).not.toHaveBeenCalled();
          expect(recorder.updates().some((u) => u.sessionUpdate === "session_disconnected")).toBe(
            false
          );
        } finally {
          jest.useRealTimers();
        }
      });

      it(`closes the query and reports the disconnect when a stalled turn's interrupt gets no result either (${ISSUE_175})`, async () => {
        jest.useFakeTimers();
        try {
          const { live, fake, recorder, ended } = startLive(1_000);
          live.push("prompt-1", "hi");
          fake.echo(await fake.nextInput());
          fake.emit(textDelta("half a sent"));
          await recorder.waitFor("agent_message_chunk");

          jest.advanceTimersByTime(1_000);
          await recorder.waitFor("turn_ended");
          jest.advanceTimersByTime(1_000);
          await ended;

          expect(fake.close).toHaveBeenCalledTimes(1);
          expect(lifecycle(recorder.updates())).toEqual([
            "delivered prompt-1",
            "turn_started",
            `turn_ended error: ${SDK_STREAM_STALL_MESSAGE}`,
            `disconnected: ${SDK_STREAM_STALL_MESSAGE}`,
          ]);
        } finally {
          jest.useRealTimers();
        }
      });

      it(`never arms the stall guard on a subagent's frames, so a quiet main turn with a busy subagent does not stall (${ISSUE_175})`, async () => {
        jest.useFakeTimers();
        try {
          const { live, fake, recorder } = startLive(1_000);
          live.push("prompt-1", "hi");
          fake.echo(await fake.nextInput());
          fake.emit(textDelta("subagent text", "toolu_agent"));
          await recorder.waitFor("agent_message_chunk");
          jest.advanceTimersByTime(5_000);

          expect(fake.interrupt).not.toHaveBeenCalled();
          expect(recorder.updates().some((u) => u.sessionUpdate === "turn_ended")).toBe(false);
        } finally {
          jest.useRealTimers();
        }
      });

      it(`still ends a stalled main turn while a background subagent keeps reporting progress (${ISSUE_175})`, async () => {
        jest.useFakeTimers();
        try {
          const { live, fake, recorder } = startLive(1_000);
          live.push("prompt-1", "hi");
          fake.echo(await fake.nextInput());
          fake.emit(
            taskFrame("task_started", { tool_use_id: "toolu_agent", task_type: "local_agent" }),
            textDelta("half a sent")
          );
          await recorder.waitFor("agent_message_chunk");

          jest.advanceTimersByTime(600);
          fake.emit(taskFrame("task_progress", { last_tool_name: "Bash" }));
          await recorder.waitFor("task_progress");
          jest.advanceTimersByTime(600);

          expect(lifecycle(recorder.updates())).toContain(
            `turn_ended error: ${SDK_STREAM_STALL_MESSAGE}`
          );
          expect(fake.interrupt).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });
    });

    describe("interrupt()", () => {
      it(`withdraws each prompt Claude has not read and reports them together, then interrupts without cancel_queued, so a background task's report waiting in Claude's queue survives Stop (${ISSUE_747})`, async () => {
        const { live, fake, recorder } = startLive();
        live.push("prompt-1", "first");
        live.push("prompt-2", "second");
        live.push("prompt-3", "third");
        fake.echo(await fake.nextInput(0));
        await recorder.waitFor("message_delivered");
        const answers: Array<() => void> = [];
        fake.cancelAsyncMessage.mockImplementation(
          (uuid) =>
            new Promise<boolean>((resolve) => {
              fake.emit(commandLifecycle(uuid, "cancelled"));
              answers.push(() => resolve(true));
            })
        );

        const stopped = live.interrupt();
        fake.emit(textDelta("still streaming"));
        await recorder.waitFor("agent_message_chunk");
        for (const answer of answers) answer();
        await stopped;

        expect(fake.cancelAsyncMessage.mock.calls).toEqual([["prompt-2"], ["prompt-3"]]);
        expect(fake.interrupt).toHaveBeenCalledWith();
        expect(fake.interrupt.mock.invocationCallOrder[0]).toBeGreaterThan(
          Math.max(...fake.cancelAsyncMessage.mock.invocationCallOrder)
        );
        expect(lifecycle(recorder.updates())).toEqual([
          "delivered prompt-1",
          "turn_started",
          "withdrawn prompt-2,prompt-3",
        ]);
      });

      it(`still interrupts the turn when withdrawing a prompt fails (${ISSUE_747})`, async () => {
        const { live, fake } = startLive();
        live.push("prompt-1", "first");
        fake.cancelAsyncMessage.mockRejectedValue(new Error("control request failed"));

        await live.interrupt();

        expect(fake.interrupt).toHaveBeenCalledTimes(1);
      });

      it(`does not report a sign-out when the stopped turn ends without naming an error (${ISSUE_747})`, async () => {
        const { live, fake, recorder, onSignedOut } = startLive();
        live.push("prompt-1", "hi");
        fake.echo(await fake.nextInput());

        await live.interrupt();
        fake.emit(resultFrame({ subtype: "error_during_execution", is_error: true, errors: [] }));
        await recorder.waitFor("turn_ended");

        expect(onSignedOut).not.toHaveBeenCalled();
      });
    });

    describe("cancelQueued()", () => {
      it(`withdraws one queued prompt by its uuid and reports it withdrawn (${ISSUE_747})`, async () => {
        const { live, fake, recorder } = startLive();
        live.push("prompt-1", "first");
        live.push("prompt-2", "second");
        fake.cancelAsyncMessage.mockResolvedValue(true);

        await expect(live.cancelQueued("prompt-2")).resolves.toBe(true);

        expect(fake.cancelAsyncMessage).toHaveBeenCalledWith("prompt-2");
        expect(lifecycle(recorder.updates())).toEqual(["withdrawn prompt-2"]);
      });

      it(`reports nothing when Claude has already taken the prompt, and its echo still delivers it (${ISSUE_747})`, async () => {
        const { live, fake, recorder } = startLive();
        live.push("prompt-1", "first");
        fake.cancelAsyncMessage.mockResolvedValue(false);

        await expect(live.cancelQueued("prompt-1")).resolves.toBe(false);
        fake.echo(await fake.nextInput(0));
        await recorder.waitFor("message_delivered");

        expect(lifecycle(recorder.updates())).toEqual(["delivered prompt-1", "turn_started"]);
      });
    });

    describe("close()", () => {
      it("ends the query and its input without reporting a disconnect", async () => {
        const { live, fake, recorder, ended } = startLive();
        live.push("prompt-1", "hi");
        await fake.nextInput();

        live.close();
        await ended;

        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(recorder.updates().some((u) => u.sessionUpdate === "session_disconnected")).toBe(
          false
        );
      });
    });
  });
});
