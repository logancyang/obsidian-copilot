import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  AgentTaskCoordinator,
  type AgentTaskExecutor,
} from "@/agentMode/session/AgentTaskCoordinator";
import type {
  AgentVoiceAttachment,
  AgentVoiceSubmissionResolver,
} from "@/agentMode/session/voiceTypes";
import {
  TRANSCRIPT_MAX_WAIT_MS,
  TRANSCRIPT_SETTLE_MS,
  VoiceConversationBridge,
} from "@/agentMode/voice/VoiceConversationBridge";
import type { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import type { VoiceSessionSnapshot, VoiceSessionEvent } from "@/agentMode/voice/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function createHarness(resolveSubmission?: AgentVoiceSubmissionResolver) {
  let emit!: (event: VoiceSessionEvent) => void;
  let controls!: AgentVoiceAttachment;
  let sequence = 0;
  const store = new AgentMessageStore();
  const submitTask = jest.fn<
    ReturnType<AgentTaskExecutor["submitTask"]>,
    Parameters<AgentTaskExecutor["submitTask"]>
  >((submission, taskId) => {
    store.recordTask({
      taskId,
      sourceMessageIds: [...submission.sourceMessageIds],
      assistantMessageId: "answer",
      delegationIds: [submission.delegationId!],
      state: "running",
      presentation: submission.presentation,
    });
    return { assistantMessageId: "answer", turn: new Promise(() => {}) };
  });
  const tasks = new AgentTaskCoordinator({
    submitTask,
    settleTask: jest.fn(),
    cancel: jest.fn(),
    getTask: (id) => store.getTask(id),
  });
  let snapshot = {
    state: "active",
    voiceSessionId: "voice-1",
    outputLevel: 0.4,
    startedAtMs: 1000,
  } as VoiceSessionSnapshot;
  const controller = {
    subscribe: (listener: (event: VoiceSessionEvent) => void) => {
      emit = listener;
      return () => {
        emit = () => {};
      };
    },
    start: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    getSnapshot: () => snapshot,
    acceptDelegation: jest.fn(),
    deferDelegation: jest.fn(),
    updateTask: jest.fn(),
  };
  const bridge = new VoiceConversationBridge({
    checkEnvironment: () => null,
    newSubmissionId: () => `submission-${++sequence}`,
    createCall: () => ({
      controller: controller as unknown as VoiceSessionController,
      timers: {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      },
    }),
  });
  bridge.attach({
    backendDisplayName: "Codex",
    resolveSubmission,
    getSelectedBackendIds: () => ["codex"],
    chat: {
      attachVoice: (attachment) => {
        if (attachment) controls = attachment;
      },
    },
    conversation: {
      internalId: "chat-1",
      store,
      tasks,
      getConversationId: () => "conversation-1",
      getStatus: () => "idle",
      subscribe: () => () => {},
      notifyConversationChanged: () => {},
    },
  });
  const transcript = (role: "user" | "assistant", delta: string, endMs = 6200) =>
    emit({
      type: "transcript.delta",
      delta: {
        voiceSessionId: "voice-1",
        liveEventId: `fragment-${++sequence}`,
        role,
        delta,
        startMs: endMs - 200,
        endMs,
      },
    });
  const delegate = (id = "delegation-1", offsetMs = 6000) =>
    emit({ type: "delegation.requested", liveDelegationId: id, offsetMs });
  const changeState = (change: Partial<VoiceSessionSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    emit({ type: "state.changed", snapshot });
  };
  return {
    bridge,
    controls,
    controller,
    store,
    tasks,
    submitTask,
    transcript,
    delegate,
    changeState,
  };
}

describe("VoiceConversationBridge", () => {
  describe("VoiceConversationBridge", () => {
    describe("attach()", () => {
      let h: ReturnType<typeof createHarness>;
      beforeEach(async () => {
        jest.useFakeTimers();
        h = createHarness();
        await h.controls.start();
      });
      afterEach(async () => {
        await h.bridge.dispose();
        jest.useRealTimers();
      });

      it("exposes measured audio and the active start time through the conversation controls", () => {
        expect(h.controls.getState()).toMatchObject({ outputLevel: 0.4, startedAtMs: 1000 });
      });

      it("retains a disconnected call's error and allows a fresh call without changing existing tasks or text", async () => {
        h.transcript("user", "Find notes about Obsidian");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        const task = h.tasks.getActiveTask();
        const text = h.store.getDisplayMessages().map((message) => message.message);
        h.changeState({ state: "off", errorCode: "transport", outputLevel: 0 });
        expect(h.bridge.getActiveConversationId()).toBeNull();
        expect(h.controls.getState()).toMatchObject({ session: "off", errorCode: "transport" });
        expect(h.tasks.getActiveTask()).toBe(task);
        expect(h.store.getDisplayMessages().map((message) => message.message)).toEqual(text);
        h.controller.start.mockImplementationOnce(async () => {
          h.changeState({ state: "active", errorCode: null });
        });
        await expect(h.controls.start()).resolves.toEqual({ started: true });
        expect(h.controls.getState()).toMatchObject({ session: "active", errorCode: null });
      });

      it("clears a retained disconnect error when the user ends the already stopped call", async () => {
        h.changeState({ state: "off", errorCode: "transport" });
        await h.controls.end();
        expect(h.controls.getState()).toMatchObject({ session: "off", errorCode: null });
      });

      it("keeps closing visible and refuses a new call until the old transport finishes closing", async () => {
        let finish!: () => void;
        const closed = new Promise<void>((resolve) => {
          finish = resolve;
        });
        h.controller.close.mockImplementation(() => {
          h.changeState({ state: "closing" });
          return closed;
        });
        const ended = h.controls.end();
        const endedAgain = h.controls.end();
        expect(h.controls.getState().session).toBe("closing");
        await expect(h.controls.start()).resolves.toMatchObject({ started: false });
        expect(h.controller.start).toHaveBeenCalledTimes(1);
        finish();
        await Promise.all([ended, endedAgain]);
        expect(h.controls.getState().session).toBe("off");
        await expect(h.controls.start()).resolves.toEqual({ started: true });
      });

      it("waits for local attachments and accepts a repeated delegation only once", async () => {
        let finish!: (value: {
          promptContent: [{ type: "image"; mimeType: string; data: string }];
        }) => void;
        h = createHarness(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );
        await h.controls.start();
        h.transcript("user", "Explain the image");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_MAX_WAIT_MS);
        expect(h.submitTask).not.toHaveBeenCalled();
        expect(h.controller.deferDelegation).not.toHaveBeenCalled();
        finish({ promptContent: [{ type: "image", mimeType: "image/png", data: "AQI=" }] });
        await jest.advanceTimersByTimeAsync(0);
        expect(h.submitTask).toHaveBeenCalledTimes(1);
        expect(h.submitTask.mock.calls[0][0].promptContent).toEqual([
          { type: "image", mimeType: "image/png", data: "AQI=" },
        ]);
      });
      it("preserves speech order when a later request's attachments finish first", async () => {
        let finishFirst!: (value: Awaited<ReturnType<AgentVoiceSubmissionResolver>>) => void;
        const resolve = jest
          .fn<ReturnType<AgentVoiceSubmissionResolver>, Parameters<AgentVoiceSubmissionResolver>>()
          .mockImplementationOnce(
            () =>
              new Promise((done) => {
                finishFirst = done;
              })
          )
          .mockResolvedValueOnce({});
        h = createHarness(resolve);
        await h.controls.start();
        h.transcript("user", "Explain the image");
        h.delegate("first");
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        h.transcript("assistant", "I will check it.", 6400);
        h.transcript("user", "Then summarize the note", 6600);
        h.delegate("second");
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        await jest.advanceTimersByTimeAsync(0);
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(h.submitTask).not.toHaveBeenCalled();
        finishFirst({ promptContent: [{ type: "image", mimeType: "image/png", data: "AQI=" }] });
        await jest.advanceTimersByTimeAsync(0);
        expect(h.submitTask.mock.calls[0][0].requestText).toBe("Explain the image");
        expect(h.tasks.getQueuedTasks()[0].submission.requestText).toBe("Then summarize the note");
      });
      it("does not dispatch speech when End voice occurs during attachment reads", async () => {
        let finish!: (value: Awaited<ReturnType<AgentVoiceSubmissionResolver>>) => void;
        h = createHarness(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );
        await h.controls.start();
        h.transcript("user", "Explain the image");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        await h.controls.end();
        finish({});
        await jest.advanceTimersByTimeAsync(0);
        expect(h.submitTask).not.toHaveBeenCalled();
        expect(h.controller.acceptDelegation).not.toHaveBeenCalled();
      });
      it("declines a spoken task when its local attachments cannot be read", async () => {
        h = createHarness(async () => {
          throw new Error("Image unreadable");
        });
        await h.controls.start();
        h.transcript("user", "Explain the image");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        await jest.advanceTimersByTimeAsync(0);
        expect(h.submitTask).not.toHaveBeenCalled();
        expect(h.controller.deferDelegation).toHaveBeenCalledWith("delegation-1", "declined");
      });
      it("dispatches settled user speech once and links the existing transcript row to its task", () => {
        h.transcript("user", "Find notes about Obsidian");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        expect(h.submitTask).toHaveBeenCalledTimes(1);
        const submission = h.submitTask.mock.calls[0][0];
        expect(submission).toMatchObject({
          requestText: "Find notes about Obsidian",
          source: "voice",
          presentation: "voice-card",
          delegationId: "delegation-1",
        });
        expect(submission.sourceMessageIds).toEqual([h.store.getDisplayMessages()[0].id]);
        expect(h.store.getPersistableConversation().tasks).toHaveLength(1);
      });

      it("dispatches complete user speech while assistant acknowledgment captions continue arriving", () => {
        h.transcript("user", "Um, I want to check my notes about, uh, Obsidian");
        h.delegate();
        // Relative arrival times captured from the native WebRTC failure.
        const captions: [number, string][] = [
          [135, " Okay,"],
          [332, " "],
          [517, "sure."],
          [907, " I'll"],
          [1313, " start"],
          [1695, " that search"],
          [2147, " now."],
        ];
        let elapsed = 0;
        for (const [at, text] of captions) {
          jest.advanceTimersByTime(at - elapsed);
          h.transcript("assistant", text, 6400 + at);
          elapsed = at;
        }
        expect(h.submitTask).toHaveBeenCalledTimes(1);
        expect(h.submitTask.mock.calls[0][0].requestText).toBe(
          "Um, I want to check my notes about, uh, Obsidian"
        );
        expect(h.controller.deferDelegation).not.toHaveBeenCalled();
        expect(
          h.store.getDisplayMessages().find((message) => message.origin === "voice-assistant")
            ?.message
        ).toBe("Okay, sure. I'll start that search now.");
      });

      it("dispatches complete speech when delegation is created after the user stopped speaking", () => {
        h.transcript("user", "Find notes about Obsidian", 15400);
        h.delegate("delegation-1", 19600);
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        expect(h.submitTask).toHaveBeenCalledTimes(1);
        expect(h.submitTask.mock.calls[0][0].requestText).toBe("Find notes about Obsidian");
        expect(h.controller.deferDelegation).not.toHaveBeenCalled();
      });

      it("waits for delayed user fragments and restarts settling when the user completes the request", () => {
        h.delegate();
        h.transcript("user", "Find notes about ", 5800);
        jest.advanceTimersByTime(300);
        expect(h.submitTask).not.toHaveBeenCalled();
        h.transcript("user", "Obsidian", 6200);
        jest.advanceTimersByTime(300);
        h.transcript("user", " plugins", 6400);
        jest.advanceTimersByTime(499);
        expect(h.submitTask).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(h.submitTask.mock.calls[0][0].requestText).toBe("Find notes about Obsidian plugins");
      });

      it("does not dispatch a repeated delegation or reuse speech already assigned to a task", () => {
        h.transcript("user", "Find notes about Obsidian");
        h.delegate();
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        h.delegate();
        h.delegate("delegation-2");
        jest.advanceTimersByTime(TRANSCRIPT_MAX_WAIT_MS);
        expect(h.submitTask).toHaveBeenCalledTimes(1);
        expect(h.tasks.getQueuedTasks()).toHaveLength(0);
        expect(h.controller.deferDelegation).toHaveBeenCalledWith(
          "delegation-2",
          "already-claimed"
        );
      });

      it("reports no transcript on timeout and permits a later delegation once speech arrives", () => {
        h.transcript("assistant", "I will check that.");
        h.transcript("user", "  ");
        h.delegate();
        jest.advanceTimersByTime(TRANSCRIPT_MAX_WAIT_MS);
        expect(h.submitTask).not.toHaveBeenCalled();
        expect(h.controller.deferDelegation).toHaveBeenCalledWith("delegation-1", "no-transcript");
        h.transcript("user", "Find notes about Obsidian", 6200);
        h.delegate("delegation-2");
        jest.advanceTimersByTime(TRANSCRIPT_SETTLE_MS);
        expect(h.submitTask.mock.calls[0][0].requestText).toBe("Find notes about Obsidian");
      });
    });
  });
});
