import {
  AgentTaskCoordinator,
  type AgentTaskExecutor,
} from "@/agentMode/session/AgentTaskCoordinator";
import type { StopReason } from "@/agentMode/session/types";
import type {
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskSubmission,
} from "@/agentMode/session/voiceTypes";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

interface DispatchedTurn {
  submission: AgentTaskSubmission;
  taskId: string;
  resolve: (stopReason: StopReason) => void;
  reject: (error: unknown) => void;
}

/**
 * Stand-in for `AgentSession`: records what was dispatched and lets each test
 * settle a turn on demand, so ordering is observable without a backend.
 */
function makeExecutor() {
  const dispatched: DispatchedTurn[] = [];
  const settled: Array<{ taskId: string; outcome: { stopReason?: StopReason; error?: unknown } }> =
    [];
  const tasks = new Map<string, AgentTaskRecord>();
  let submitThrows: Error | null = null;
  const cancel = jest.fn(async () => {});

  const executor: AgentTaskExecutor = {
    submitTask(submission, taskId) {
      if (submitThrows) throw submitThrows;
      let resolve!: (stopReason: StopReason) => void;
      let reject!: (error: unknown) => void;
      const turn = new Promise<StopReason>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      dispatched.push({ submission, taskId, resolve, reject });
      tasks.set(taskId, {
        taskId,
        sourceMessageIds: [`user-${taskId}`],
        assistantMessageId: `assistant-${taskId}`,
        delegationIds: submission.delegationId ? [submission.delegationId] : [],
        state: "running",
        presentation: submission.presentation,
      });
      return { assistantMessageId: `assistant-${taskId}`, turn };
    },
    settleTask(taskId, outcome): AgentTaskResult {
      settled.push({ taskId, outcome });
      const state =
        outcome.error !== undefined
          ? "failed"
          : outcome.stopReason === "cancelled"
            ? "cancelled"
            : "completed";
      const existing = tasks.get(taskId);
      if (existing) tasks.set(taskId, { ...existing, state });
      return {
        taskId,
        state,
        assistantMessageId: existing?.assistantMessageId ?? "",
        answerText: "",
      };
    },
    cancel,
    getTask: (taskId) => tasks.get(taskId),
  };

  return {
    executor,
    dispatched,
    settled,
    cancel,
    failNextSubmit: (error: Error) => {
      submitThrows = error;
    },
  };
}

const typed = (
  submissionId: string,
  requestText: string,
  extra: Partial<AgentTaskSubmission> = {}
): AgentTaskSubmission => ({
  submissionId,
  conversationId: "chat-1",
  sourceMessageIds: [],
  source: "typed",
  presentation: "text",
  requestText,
  rawInput: requestText,
  ...extra,
});

const spoken = (
  submissionId: string,
  requestText: string,
  extra: Partial<AgentTaskSubmission> = {}
): AgentTaskSubmission => ({
  submissionId,
  conversationId: "chat-1",
  sourceMessageIds: [`voice-row-${submissionId}`],
  source: "voice",
  presentation: "voice-card",
  requestText,
  voiceSessionId: "voice-1",
  ...extra,
});

describe("AgentTaskCoordinator", () => {
  describe("AgentTaskCoordinator", () => {
    describe("submit()", () => {
      it("dispatches the first submission immediately and reports the task it created", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        const acceptance = coordinator.submit(typed("s1", "summarize this note"));

        expect(acceptance.disposition).toBe("dispatched");
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].taskId).toBe(acceptance.taskId);
        expect(coordinator.getActiveTask()?.taskId).toBe(acceptance.taskId);
      });

      it("keeps only one turn in flight, parking later submissions in send order", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "second"));
        coordinator.submit(typed("s3", "third"));

        expect(dispatched).toHaveLength(1);
        expect(coordinator.getQueuedTasks().map((t) => t.submission.requestText)).toEqual([
          "second",
          "third",
        ]);
      });

      it("labels a submission parked behind a running turn as busy", () => {
        const { executor } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "second"));

        expect(coordinator.getQueuedTasks()[0].queueReason).toBe("busy");
      });

      it("returns the original task for a repeated submission id without dispatching again", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        const first = coordinator.submit(typed("s1", "find my notes"));
        const repeat = coordinator.submit(typed("s1", "find my notes"));

        expect(repeat).toEqual({ taskId: first.taskId, disposition: "duplicate" });
        expect(dispatched).toHaveLength(1);
      });

      it("returns the original task for a repeated voice delegation id https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
        // A delegation notification can arrive twice; the second must map to
        // the task the first created rather than running the work again.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Idempotence and recovery".
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        const first = coordinator.submit(spoken("s1", "find my notes", { delegationId: "d1" }));
        const repeat = coordinator.submit(spoken("s2", "find my notes", { delegationId: "d1" }));

        expect(repeat).toEqual({ taskId: first.taskId, disposition: "duplicate" });
        expect(dispatched).toHaveLength(1);
      });

      it("keeps each spoken request a distinct task instead of merging them", async () => {
        // Spoken requests have explicit source boundaries; merging two would
        // lose the delegation each answer belongs to.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        coordinator.submit(typed("s0", "warm up"));
        const second = coordinator.submit(
          spoken("s1", "find planning notes", { delegationId: "d1" })
        );
        const third = coordinator.submit(
          spoken("s2", "now summarize them", { delegationId: "d2" })
        );

        expect(second.taskId).not.toBe(third.taskId);
        dispatched[0].resolve("end_turn");
        await Promise.resolve();
        expect(dispatched).toHaveLength(2);
        expect(dispatched[1].submission.requestText).toBe("find planning notes");
        expect(coordinator.getQueuedTasks().map((t) => t.submission.requestText)).toEqual([
          "now summarize them",
        ]);
      });

      it("records a rejection when the session refuses the turn", () => {
        const { executor, failNextSubmit } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        failNextSubmit(new Error("Session is closed"));

        const acceptance = coordinator.submit(typed("s1", "anything"));

        expect(acceptance.disposition).toBe("rejected");
        expect(acceptance.rejectionReason).toBe("Session is closed");
        expect(coordinator.getActiveTask()).toBeNull();
      });
    });

    describe("setDispatchHold()", () => {
      it("parks a submission with the hold's reason instead of dispatching it", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold("context");

        coordinator.submit(typed("s1", "held while context loads"));

        expect(dispatched).toHaveLength(0);
        expect(coordinator.getQueuedTasks()[0].queueReason).toBe("context");
      });

      it("dispatches the parked queue as soon as the hold is released", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold("context");
        coordinator.submit(typed("s1", "held while context loads"));

        coordinator.setDispatchHold(null);

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].submission.requestText).toBe("held while context loads");
      });

      it("leaves a backgrounded conversation's queue untouched when its turn ends", async () => {
        // Switching chats must not secretly flush work into a conversation the
        // user is no longer looking at.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "queued follow-up"));

        coordinator.setDispatchHold("busy");
        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched).toHaveLength(1);
        expect(coordinator.getQueuedTasks()).toHaveLength(1);

        coordinator.setDispatchHold(null);
        expect(dispatched).toHaveLength(2);
      });
    });

    describe("getQueuedTasks()", () => {
      it("returns the same reference while the queue stays empty", () => {
        const { executor } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);

        expect(coordinator.getQueuedTasks()).toBe(coordinator.getQueuedTasks());
      });
    });

    describe("removeQueuedTask()", () => {
      it("drops a parked submission so it is never dispatched", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        const queued = coordinator.submit(typed("s2", "dismissed"));

        expect(coordinator.removeQueuedTask(queued.taskId)).toBe(true);
        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched).toHaveLength(1);
      });
    });

    describe("cancelActiveAndClearQueue()", () => {
      it("discards queued submissions before requesting cancellation https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "queued follow-up"));
        // A cancellation that ends the active turn must not find work to flush.
        cancel.mockImplementation(async () => {
          expect(coordinator.getQueuedTasks()).toHaveLength(0);
          dispatched[0].resolve("cancelled");
        });

        await coordinator.cancelActiveAndClearQueue();
        await Promise.resolve();

        expect(dispatched).toHaveLength(1);
        expect(coordinator.getQueuedTasks()).toHaveLength(0);
      });

      it("still clears the queue when cancellation fails https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
        const { executor, cancel } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "queued follow-up"));
        cancel.mockRejectedValueOnce(new Error("cancel failed"));

        await coordinator.cancelActiveAndClearQueue();

        expect(coordinator.getQueuedTasks()).toHaveLength(0);
        expect(coordinator.isBusy()).toBe(true);
      });
    });

    describe("onTaskSettled()", () => {
      it("reports the settled outcome once the turn resolves", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        const results: AgentTaskResult[] = [];
        coordinator.onTaskSettled((result) => results.push(result));
        const accepted = coordinator.submit(typed("s1", "first"));

        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(results).toEqual([
          expect.objectContaining({ taskId: accepted.taskId, state: "completed" }),
        ]);
        expect(coordinator.isBusy()).toBe(false);
      });

      it("reports a rejected turn as failed rather than completed", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        const results: AgentTaskResult[] = [];
        coordinator.onTaskSettled((result) => results.push(result));
        coordinator.submit(typed("s1", "first"));

        dispatched[0].reject(new Error("transport died"));
        await Promise.resolve();
        await Promise.resolve();

        expect(results[0].state).toBe("failed");
      });

      it("leaves the replacement task running when a cancelled turn's result arrives", async () => {
        // A result carries the generation it was dispatched with, so a
        // superseded turn records its own outcome and nothing else instead of
        // freeing the slot the replacement now owns.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched, settled, cancel } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        const stale = coordinator.submit(typed("s1", "first"));
        cancel.mockImplementation(async () => {
          dispatched[0].resolve("cancelled");
        });
        await coordinator.cancelActiveAndClearQueue();
        await Promise.resolve();
        const replacement = coordinator.submit(typed("s2", "new turn after Stop"));

        // The first turn's backend promise settles only now, after replacement.
        dispatched[0].resolve("end_turn");
        await Promise.resolve();
        await Promise.resolve();

        expect(settled.map((s) => s.taskId)).toContain(stale.taskId);
        expect(coordinator.getActiveTask()?.taskId).toBe(replacement.taskId);
        expect(coordinator.isBusy()).toBe(true);
      });
    });

    describe("drain()", () => {
      it("combines consecutive typed follow-ups into one turn in send order", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "second"));
        coordinator.submit(typed("s3", "third"));

        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched).toHaveLength(2);
        expect(dispatched[1].submission.requestText).toBe("second\n\nthird");
        expect(coordinator.getQueuedTasks()).toHaveLength(0);
      });

      it("keeps every merged submission id resolving to the surviving task", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        const second = coordinator.submit(typed("s2", "second"));
        const third = coordinator.submit(typed("s3", "third"));

        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(coordinator.submit(typed("s3", "third"))).toEqual({
          taskId: second.taskId,
          disposition: "duplicate",
        });
        expect(third.taskId).not.toBe(second.taskId);
      });

      it("merges the attachments and answerer selections of the combined follow-ups", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(
          typed("s2", "second", {
            promptContent: [{ type: "image", mimeType: "image/png", data: "AA==" }],
            mentionedAgents: ["claude"],
          })
        );
        coordinator.submit(typed("s3", "third", { mentionedAgents: ["claude", "codex"] }));

        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched[1].submission.promptContent).toHaveLength(1);
        expect(dispatched[1].submission.mentionedAgents).toEqual(["claude", "codex"]);
        expect(dispatched[1].submission.rawInput).toBe("second\n\nthird");
      });
    });
  });
});
