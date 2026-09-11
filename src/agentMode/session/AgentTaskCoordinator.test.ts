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
      if (submitThrows) {
        const error = submitThrows;
        submitThrows = null;
        throw error;
      }
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
    /** Refuse exactly the next dispatch, the way a closed session would. */
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

      it.each([typed, spoken])(
        "interrupts active work for an accepted replacement request",
        async (submission) => {
          const { executor, dispatched, cancel, settled } = makeExecutor();
          Object.assign(executor, { supportsSteering: () => true });
          const coordinator = new AgentTaskCoordinator(executor);
          coordinator.submit(typed("s1", "read every note"));
          cancel.mockImplementation(async () => {
            dispatched[0].resolve("cancelled");
          });

          const replacement = coordinator.submit(submission("s2", "only read the selected note"));
          await flushMicrotasks();

          expect(cancel).toHaveBeenCalledTimes(1);
          expect(settled[0].outcome).toEqual({ stopReason: "cancelled" });
          expect(dispatched.map((turn) => turn.submission.requestText)).toEqual([
            "read every note",
            "only read the selected note",
          ]);
          expect(coordinator.getActiveTask()?.taskId).toBe(replacement.taskId);
        }
      );

      it("coalesces rapid typed replacements while cancellation is pending without cancelling their turn", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        let finishCancel!: () => void;
        cancel.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finishCancel = resolve;
            })
        );
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "use the selected note"));
        coordinator.submit(typed("s3", "keep it short"));
        await flushMicrotasks();
        expect(cancel).toHaveBeenCalledTimes(1);
        dispatched[0].resolve("cancelled");
        await flushMicrotasks();
        expect(dispatched).toHaveLength(1);

        finishCancel();
        await flushMicrotasks();
        expect(dispatched).toHaveLength(2);
        expect(dispatched[1].submission.requestText).toBe("use the selected note\n\nkeep it short");
        expect(cancel).toHaveBeenCalledTimes(1);
      });

      it("does not cancel a replacement twice when more requests arrive after cancellation returns", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "second"));
        await flushMicrotasks();
        coordinator.submit(typed("s3", "third"));
        await flushMicrotasks();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispatched).toHaveLength(1);
      });

      it("keeps replacement work parked when its composer is backgrounded during cancellation", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold(null);
        coordinator.submit(typed("s1", "first"));
        cancel.mockImplementation(async () => {
          dispatched[0].resolve("cancelled");
        });
        coordinator.submit(spoken("s2", "second"));
        coordinator.releaseDispatchHold();
        await flushMicrotasks();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispatched).toHaveLength(1);
        expect(coordinator.getQueuedTasks()).toHaveLength(1);
        coordinator.setDispatchHold(null);
        expect(dispatched).toHaveLength(2);
      });

      it("treats a repeated delegation as the same replacement without interrupting it again", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        cancel.mockImplementation(async () => {
          dispatched[0].resolve("cancelled");
        });
        const replacement = spoken("s2", "second", { delegationId: "delegation-2" });
        coordinator.submit(replacement);
        await flushMicrotasks();
        expect(coordinator.submit({ ...replacement, submissionId: "s3" }).disposition).toBe(
          "duplicate"
        );
        await flushMicrotasks();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispatched).toHaveLength(2);
      });

      it.each([
        [spoken, spoken],
        [typed, spoken],
        [spoken, typed],
      ])(
        "replaces a pending voice handoff with the newest request and reports abandoned work cancelled",
        async (previous, latest) => {
          const { executor, dispatched, cancel } = makeExecutor();
          Object.assign(executor, { supportsSteering: () => true });
          const coordinator = new AgentTaskCoordinator(executor);
          const results: AgentTaskResult[] = [];
          coordinator.onTaskSettled((result) => results.push(result));
          let finishCancel!: () => void;
          cancel.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                finishCancel = resolve;
              })
          );
          coordinator.submit(typed("s1", "first"));
          const superseded = coordinator.submit(previous("s2", "obsolete replacement"));
          await flushMicrotasks();
          expect(cancel).toHaveBeenCalledTimes(1);
          dispatched[0].resolve("cancelled");
          await flushMicrotasks();
          const replacement = coordinator.submit(latest("s3", "latest replacement"));
          expect(results).toContainEqual(
            expect.objectContaining({ taskId: superseded.taskId, state: "cancelled" })
          );
          finishCancel();
          await flushMicrotasks();
          expect(dispatched.map((turn) => turn.submission.requestText)).toEqual([
            "first",
            "latest replacement",
          ]);
          expect(coordinator.getActiveTask()?.taskId).toBe(replacement.taskId);
          expect(cancel).toHaveBeenCalledTimes(1);
        }
      );

      it("starts the replacement without cancellation when the previous task already completed", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.submit(typed("s1", "first"));
        dispatched[0].resolve("end_turn");
        const replacement = coordinator.submit(typed("s2", "second"));
        await flushMicrotasks();
        expect(cancel).not.toHaveBeenCalled();
        expect(dispatched.map((turn) => turn.submission.requestText)).toEqual(["first", "second"]);
        expect(coordinator.getActiveTask()?.taskId).toBe(replacement.taskId);
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

      it("parks a submission made while earlier work is still queued behind it", async () => {
        // A refused dispatch frees the active slot while the queue is still
        // full; a submission arriving in that window (here from a settlement
        // listener) must not overtake the requests the user sent first.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched, failNextSubmit } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold("busy");
        coordinator.submit(spoken("s1", "refused request", { delegationId: "d1" }));
        coordinator.submit(spoken("s2", "queued first", { delegationId: "d2" }));
        let reentered = false;
        coordinator.onTaskSettled(() => {
          if (reentered) return;
          reentered = true;
          coordinator.submit(spoken("s3", "submitted during settlement", { delegationId: "d3" }));
        });
        failNextSubmit(new Error("Session is closed"));

        coordinator.setDispatchHold(null);

        expect(dispatched.map((d) => d.submission.requestText)).toEqual(["queued first"]);
        expect(coordinator.getQueuedTasks().map((t) => t.submission.requestText)).toEqual([
          "submitted during settlement",
        ]);
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

      it("holds dispatch while any registered composer reports a reason", () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold(null, "sidebar");
        coordinator.setDispatchHold("context", "popout");

        coordinator.submit(typed("s1", "held while one composer waits for context"));

        expect(dispatched).toHaveLength(0);
        expect(coordinator.getQueuedTasks()[0].queueReason).toBe("context");
      });
    });

    describe("releaseDispatchHold()", () => {
      it("keeps dispatching for the composer that is still mounted", async () => {
        // A conversation open in the sidebar and in a popout has two
        // composers; closing one must not park the other one's queue.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold(null, "sidebar");
        coordinator.setDispatchHold(null, "popout");
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "queued follow-up"));

        coordinator.releaseDispatchHold("popout");
        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched.map((d) => d.submission.requestText)).toEqual([
          "first",
          "queued follow-up",
        ]);
      });

      it("parks the queue once the last composer unmounts", async () => {
        const { executor, dispatched } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold(null, "sidebar");
        coordinator.submit(typed("s1", "first"));
        coordinator.submit(typed("s2", "queued follow-up"));

        coordinator.releaseDispatchHold("sidebar");
        dispatched[0].resolve("end_turn");
        await Promise.resolve();

        expect(dispatched).toHaveLength(1);
        expect(coordinator.getQueuedTasks()).toHaveLength(1);
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
      it("discards the steering replacement when Stop races pending cancellation", async () => {
        const { executor, dispatched, cancel } = makeExecutor();
        Object.assign(executor, { supportsSteering: () => true });
        const coordinator = new AgentTaskCoordinator(executor);
        const results: AgentTaskResult[] = [];
        coordinator.onTaskSettled((result) => results.push(result));
        let finishCancel!: () => void;
        cancel.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finishCancel = resolve;
            })
        );
        coordinator.submit(typed("s1", "first"));
        const replacement = coordinator.submit(spoken("s2", "second"));
        await flushMicrotasks();
        const stopped = coordinator.cancelActiveAndClearQueue();
        expect(coordinator.getQueuedTasks()).toHaveLength(0);
        expect(results).toContainEqual(
          expect.objectContaining({ taskId: replacement.taskId, state: "cancelled" })
        );
        dispatched[0].resolve("cancelled");
        finishCancel();
        await stopped;
        await flushMicrotasks();
        expect(dispatched).toHaveLength(1);
        expect(cancel).toHaveBeenCalledTimes(1);
      });

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

      it("starts the next queued submission when the session refuses the current one", () => {
        // A refusal frees the slot without any turn to settle it, so nothing
        // else would ever restart the queue.
        // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
        const { executor, dispatched, failNextSubmit } = makeExecutor();
        const coordinator = new AgentTaskCoordinator(executor);
        coordinator.setDispatchHold("busy");
        coordinator.submit(spoken("s1", "refused request", { delegationId: "d1" }));
        coordinator.submit(spoken("s2", "still has to run", { delegationId: "d2" }));
        failNextSubmit(new Error("Session is closed"));

        coordinator.setDispatchHold(null);

        expect(dispatched.map((d) => d.submission.requestText)).toEqual(["still has to run"]);
        expect(coordinator.getQueuedTasks()).toHaveLength(0);
      });
    });
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
