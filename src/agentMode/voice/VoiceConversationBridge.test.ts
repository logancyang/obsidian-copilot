import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  AgentTaskCoordinator,
  type AgentTaskExecutor,
} from "@/agentMode/session/AgentTaskCoordinator";
import type { AgentVoiceAttachment } from "@/agentMode/session/voiceTypes";
import {
  TRANSCRIPT_MAX_WAIT_MS,
  TRANSCRIPT_SETTLE_MS,
  VoiceConversationBridge,
} from "@/agentMode/voice/VoiceConversationBridge";
import type { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import type { VoiceSessionEvent } from "@/agentMode/voice/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function createHarness() {
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
  const controller = {
    subscribe: (listener: (event: VoiceSessionEvent) => void) => {
      emit = listener;
      return () => {};
    },
    start: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    getSnapshot: () => ({ state: "active", voiceSessionId: "voice-1" }),
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
  return { bridge, controls, controller, store, tasks, submitTask, transcript, delegate };
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
