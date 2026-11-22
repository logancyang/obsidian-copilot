import { AnswerCompletion } from "@/agentMode/session/answerCompletion";
import type { SessionEvent, SessionUpdate } from "@/agentMode/session/types";

function event(update: SessionUpdate, taskToolCallId?: string): SessionEvent {
  return { sessionId: "s-claude", update, ...(taskToolCallId ? { taskToolCallId } : {}) };
}

function text(chunk: string, taskToolCallId?: string): SessionEvent {
  return event(
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
    taskToolCallId
  );
}

const turnStarted = (turnId: string) => event({ sessionUpdate: "turn_started", turnId });
const turnEnded = (turnId: string, error?: Error) =>
  event({ sessionUpdate: "turn_ended", turnId, stopReason: "end_turn", error });
const taskStarted = (taskId: string) =>
  event({
    sessionUpdate: "task_started",
    taskId,
    toolCallId: `call-${taskId}`,
    kind: "subagent",
    description: "Read Welcome",
  });
const taskEnded = (taskId: string) =>
  event({ sessionUpdate: "task_ended", taskId, status: "completed" });

function track() {
  let answer = "";
  const completion = new AnswerCompletion((chunk) => (answer += chunk));
  const feed = (...events: SessionEvent[]) => events.map((e) => completion.handle(e));
  return { feed, answer: () => answer };
}

describe("answerCompletion", () => {
  describe("AnswerCompletion", () => {
    describe("handle()", () => {
      it("reports the answer final without an error when its turn ends, having passed on the turn's text", () => {
        const { feed, answer } = track();

        const ends = feed(turnStarted("t1"), text("Paris."), turnEnded("t1"));

        expect(ends).toEqual([null, null, { error: undefined }]);
        expect(answer()).toBe("Paris.");
      });

      it("reports the answer final with the turn's error when the turn fails", () => {
        const { feed } = track();
        const failure = new Error("model overloaded");

        const ends = feed(turnStarted("t1"), turnEnded("t1", failure));

        expect(ends[1]).toEqual({ error: failure });
      });

      it("reports the answer final when its turn ends after its background task already ended, waiting for no later turn (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)", () => {
        const { feed } = track();

        const ends = feed(
          turnStarted("t1"),
          taskStarted("task-1"),
          taskEnded("task-1"),
          turnEnded("t1")
        );

        expect(ends.at(-1)).toEqual({ error: undefined });
      });

      it("waits for a background task and includes the reply that reports it as a new paragraph, leaving the task's own text out (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)", () => {
        const { feed, answer } = track();

        const ends = feed(
          turnStarted("t1"),
          text("Launched a helper."),
          taskStarted("task-1"),
          turnEnded("t1"),
          text("helper's own notes", "call-task-1"),
          taskEnded("task-1"),
          turnStarted("t2"),
          text("REPORT: it says hello."),
          turnEnded("t2")
        );

        expect(ends.slice(0, -1).every((end) => end === null)).toBe(true);
        expect(ends.at(-1)).toEqual({ error: undefined });
        expect(answer()).toBe("Launched a helper.\n\nREPORT: it says hello.");
      });

      it("ends an answer waiting on a background task with the disconnect error when the agent exits (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)", () => {
        const { feed, answer } = track();
        const exited = new Error("Claude exited");

        const ends = feed(
          turnStarted("t1"),
          text("Launched a helper."),
          taskStarted("task-1"),
          turnEnded("t1"),
          taskEnded("task-1"),
          event({ sessionUpdate: "session_disconnected", error: exited })
        );

        expect(ends.slice(0, -1).every((end) => end === null)).toBe(true);
        expect(ends.at(-1)).toEqual({ error: exited });
        expect(answer()).toBe("Launched a helper.");
      });
    });
  });
});
