import { VoiceTransportSpike, type VoiceSpikeCall } from "@/agentMode/voice/voiceTransportSpike";
import type { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import type {
  VoiceSessionEvent,
  VoiceSessionSnapshot,
  VoiceSessionStartRequest,
} from "@/agentMode/voice/types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const IDLE_SNAPSHOT = {
  state: "off",
  voiceSessionId: null,
  locallyMuted: false,
  inputCommandPending: false,
  playbackActive: false,
  controlOnly: false,
  usage: null,
  errorCode: null,
  closeReason: null,
  closureConfirmed: true,
} as const satisfies VoiceSessionSnapshot;

class FakeController {
  readonly started: VoiceSessionStartRequest[] = [];
  readonly accepted: Array<{ liveDelegationId: string; taskId: string }> = [];
  readonly deferred: Array<{ liveDelegationId: string; reason: string }> = [];
  readonly taskUpdates: Array<Record<string, unknown>> = [];
  closedWith: string | undefined | null = null;
  startError: Error | null = null;
  /** Set to a never-settling promise to hold the call in its closing window. */
  closeDelay: Promise<void> | null = null;
  startCount = 0;

  private listener: ((event: VoiceSessionEvent) => void) | null = null;

  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  start(request: VoiceSessionStartRequest): Promise<void> {
    this.started.push(request);
    this.startCount += 1;
    return this.startError ? Promise.reject(this.startError) : Promise.resolve();
  }

  close(reason?: string): Promise<void> {
    this.closedWith = reason;
    return this.closeDelay ?? Promise.resolve();
  }

  acceptDelegation(liveDelegationId: string, taskId: string): void {
    this.accepted.push({ liveDelegationId, taskId });
  }

  deferDelegation(liveDelegationId: string, reason: string): void {
    this.deferred.push({ liveDelegationId, reason });
  }

  updateTask(update: Record<string, unknown>): void {
    this.taskUpdates.push(update);
  }

  getSnapshot(): VoiceSessionSnapshot {
    return IDLE_SNAPSHOT;
  }

  /** Publishes one controller event to the harness. */
  emit(event: VoiceSessionEvent): void {
    this.listener?.(event);
  }
}

interface Harness {
  spike: VoiceTransportSpike;
  controller: FakeController;
  notices: string[];
  /** Set to null to simulate "no Agent chat is open". */
  setCallAvailable(available: boolean): void;
}

function createHarness(): Harness {
  const controller = new FakeController();
  const notices: string[] = [];
  let available = true;
  let taskCounter = 0;

  const spike = new VoiceTransportSpike({
    createCall: (): VoiceSpikeCall | null =>
      available
        ? {
            controller: controller as unknown as VoiceSessionController,
            timers: {
              setTimeout: (handler, ms) => window.setTimeout(handler, ms),
              clearTimeout: (id) => window.clearTimeout(id),
            },
          }
        : null,
    describeCall: () => ({
      conversationId: "voice-check-1",
      backendDisplayName: "opencode",
    }),
    newTaskId: () => `voice-check-task-${++taskCounter}`,
    notify: (message) => notices.push(message),
    now: () => 5_000,
  });

  return {
    spike,
    controller,
    notices,
    setCallAvailable: (value: boolean) => {
      available = value;
    },
  };
}

function userFragment(endMs: number, liveEventId: string): VoiceSessionEvent {
  return {
    type: "transcript.delta",
    delta: {
      voiceSessionId: "vs_1",
      liveEventId,
      role: "user",
      delta: "find the launch risks",
      startMs: endMs - 400,
      endMs,
    },
  };
}

describe("voiceTransportSpike", () => {
  describe("VoiceTransportSpike", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe("toggle()", () => {
      it("opens a call seeded with a developer note and one prior exchange", async () => {
        const harness = createHarness();

        await harness.spike.toggle();

        expect(harness.controller.started).toHaveLength(1);
        const [request] = harness.controller.started;
        expect(request.conversationId).toBe("voice-check-1");
        expect(request.backendDisplayName).toBe("opencode");
        expect(request.startupContext.map((entry) => entry.role)).toEqual([
          "developer",
          "user",
          "assistant",
        ]);
        // Nobody is at the microphone during the check, so the frontend is
        // told to speak first; seeded history alone leaves the call silent.
        expect(request.instructionsSupplement).toContain("Greet the listener out loud");
        expect(harness.spike.isRunning()).toBe(true);
      });

      it("asks the user to open an Agent chat when no view can own the call", async () => {
        const harness = createHarness();
        harness.setCallAvailable(false);

        await harness.spike.toggle();

        expect(harness.controller.started).toHaveLength(0);
        expect(harness.notices[0]).toContain("Open a Copilot Agent chat");
        expect(harness.spike.isRunning()).toBe(false);
      });

      it("ends the running call on the second invocation", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        await harness.spike.toggle();

        expect(harness.controller.closedWith).toBe("voice transport check ended");
        expect(harness.spike.isRunning()).toBe(false);
      });

      it("does not open a second billable call while the first is still closing", async () => {
        const harness = createHarness();
        await harness.spike.toggle();
        // Closure waits on the server's terminal frame, so a user pressing the
        // command again during that window must not start a new call.
        harness.controller.closeDelay = new Promise(() => undefined);

        void harness.spike.toggle();
        void harness.spike.toggle();

        expect(harness.controller.startCount).toBe(1);
        expect(harness.controller.started).toHaveLength(1);
      });

      it("returns to idle and reports why when the call does not connect", async () => {
        const harness = createHarness();
        harness.controller.startError = new Error("The voice server refused the session.");

        await harness.spike.toggle();

        expect(harness.notices.at(-1)).toContain("The voice server refused the session.");
        expect(harness.spike.isRunning()).toBe(false);
      });

      it("accepts a delegation once speech covers its offset and the transcript settles", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_500,
        });
        harness.controller.emit(userFragment(1_600, "live-ev-1"));
        jest.advanceTimersByTime(500);

        expect(harness.controller.accepted).toEqual([
          { liveDelegationId: "live-delegation-1", taskId: "voice-check-task-1" },
        ]);
        expect(harness.controller.taskUpdates).toEqual([
          {
            taskId: "voice-check-task-1",
            revision: 1,
            state: "completed",
            excerpt: "The note lists three launch risks: onboarding, pricing, and support load.",
            liveDelegationId: "live-delegation-1",
          },
        ]);
      });

      it("waits out the settle window again when more speech arrives before it elapses", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_000,
        });
        harness.controller.emit(userFragment(1_100, "live-ev-1"));
        jest.advanceTimersByTime(400);
        harness.controller.emit(userFragment(1_500, "live-ev-2"));
        jest.advanceTimersByTime(400);

        expect(harness.controller.accepted).toHaveLength(0);

        jest.advanceTimersByTime(100);

        expect(harness.controller.accepted).toHaveLength(1);
      });

      it("defers the delegation when no user speech covers its offset within two seconds", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 4_000,
        });
        harness.controller.emit(userFragment(900, "live-ev-1"));
        jest.advanceTimersByTime(2_000);

        expect(harness.controller.accepted).toHaveLength(0);
        expect(harness.controller.deferred).toEqual([
          { liveDelegationId: "live-delegation-1", reason: "no-transcript" },
        ]);
      });

      it("does not let assistant speech authorize a delegation", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_000,
        });
        harness.controller.emit({
          type: "transcript.delta",
          delta: {
            voiceSessionId: "vs_1",
            liveEventId: "live-ev-9",
            role: "assistant",
            delta: "I'll look through your notes.",
            startMs: 1_000,
            endMs: 2_000,
          },
        });
        jest.advanceTimersByTime(2_000);

        expect(harness.controller.accepted).toHaveLength(0);
        expect(harness.controller.deferred).toHaveLength(1);
      });

      it("answers a delegation only once even if the server repeats it", async () => {
        const harness = createHarness();
        await harness.spike.toggle();

        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_000,
        });
        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_000,
        });
        harness.controller.emit(userFragment(1_100, "live-ev-1"));
        jest.advanceTimersByTime(500);

        expect(harness.controller.accepted).toHaveLength(1);
      });

      it("drops pending delegation timers when the call ends", async () => {
        const harness = createHarness();
        await harness.spike.toggle();
        harness.controller.emit({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 1_000,
        });

        await harness.spike.toggle();
        jest.advanceTimersByTime(5_000);

        expect(harness.controller.deferred).toHaveLength(0);
        expect(harness.controller.accepted).toHaveLength(0);
      });
    });
  });
});
