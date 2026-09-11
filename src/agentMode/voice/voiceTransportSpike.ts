import { logInfo, logWarn } from "@/logger";
import type { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import type { VoiceSessionEvent, VoiceTimers } from "@/agentMode/voice/types";
import type { StartupContextMessage } from "@/agentMode/voice/voiceProtocol";

/**
 * Seeded conversation for the harness: a developer note that frames the check
 * plus one prior exchange, which is the smallest context that exercises the
 * server's startup-context path.
 */
const SPIKE_STARTUP_CONTEXT: readonly StartupContextMessage[] = Object.freeze([
  {
    role: "developer" as const,
    content:
      "You are connected to a Copilot transport check. Keep spoken replies to one short sentence, and rely only on task facts Copilot reports.",
  },
  { role: "user" as const, content: "What did my notes say about the launch risks?" },
  {
    role: "assistant" as const,
    content: "I can ask the local agent to look that up whenever you want.",
  },
]);

/**
 * Instruction the harness appends to the voice frontend's own instructions.
 * Seeded history describes the conversation but does not make the frontend
 * speak, and this check runs with nobody at the microphone, so playback and
 * output transcripts need an explicit directive to talk first.
 */
const SPIKE_INSTRUCTIONS =
  "This call is an unattended transport check. Greet the listener out loud as soon as the call opens, then say one short sentence about the launch risks in their notes. Do not wait for the listener to speak first.";

/**
 * Canned result the harness reports so the voice frontend has something
 * concrete to speak without any local agent running.
 */
const SPIKE_RESULT_EXCERPT =
  "The note lists three launch risks: onboarding, pricing, and support load.";

/**
 * Quiet period after the newest transcript fragment before a delegation is
 * answered, and the longest the harness waits for usable speech at all. Both
 * are starting parameters to measure, not API guarantees. See
 * `designdocs/VOICE_CHAT_DEMO_DESIGN.md` → "From speech to a local task".
 */
const TRANSCRIPT_SETTLE_MS = 500;
const TRANSCRIPT_MAX_WAIT_MS = 2_000;

/** Identity and agent name the harness opens its call with. */
export interface VoiceSpikeCallDescription {
  conversationId: string;
  backendDisplayName: string;
}

/** One harness call and the timers of the window that owns it. */
export interface VoiceSpikeCall {
  controller: VoiceSessionController;
  timers: VoiceTimers;
}

/** Collaborators the harness needs; all injected so it can run under tests. */
export interface VoiceTransportSpikeDeps {
  /**
   * Builds a call bound to the window that owns the active Copilot view, or
   * returns null when no view is open to own it.
   */
  createCall: () => VoiceSpikeCall | null;
  /** Conversation identity and selected agent for this run. */
  describeCall: () => VoiceSpikeCallDescription;
  /** Task ids for accepted delegations. */
  newTaskId: () => string;
  /** Reports harness problems to the user. */
  notify: (message: string) => void;
  /** Wall clock used for the relative timings in the log. */
  now?: () => number;
}

/** One delegation the harness is still deciding about. */
interface PendingDelegation {
  liveDelegationId: string;
  offsetMs: number;
  settleTimer: number | null;
  giveUpTimer: number;
}

/**
 * Demo harness for the transport milestone. It opens one voice call, logs
 * every application event with redacted timings, and answers delegations with
 * a synthetic task so the whole speech → delegation → result path can be
 * observed in the real Obsidian runtime. It owns no conversation, no message
 * store, and no local agent work; the real coordinator replaces it.
 */
export class VoiceTransportSpike {
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingDelegation>();

  private controller: VoiceSessionController | null = null;
  private inFlight: Promise<void> | null = null;
  private timers: VoiceTimers | null = null;
  private unsubscribe: (() => void) | null = null;
  private startedAtMs = 0;
  private transcriptWatermarkMs = 0;

  constructor(private readonly deps: VoiceTransportSpikeDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** True while a harness call is open, which the command uses to toggle. */
  isRunning(): boolean {
    return this.controller !== null;
  }

  /**
   * Starts a harness call, or ends the one already running. Failures are
   * reported to the user and leave the harness idle rather than half-open.
   */
  async toggle(): Promise<void> {
    // Closure waits up to five seconds for the server's terminal frame.
    // Without this guard a second invocation inside that window would see no
    // controller and open a second billable call.
    if (this.inFlight) return this.inFlight;
    this.inFlight = (this.controller ? this.stop() : this.begin()).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async begin(): Promise<void> {
    const opened = this.deps.createCall();
    if (!opened) {
      this.deps.notify("Open a Copilot Agent chat first — the voice check runs in its window.");
      return;
    }
    const { controller, timers } = opened;
    const call = this.deps.describeCall();
    this.controller = controller;
    this.timers = timers;
    this.startedAtMs = this.now();
    this.transcriptWatermarkMs = 0;
    this.unsubscribe = controller.subscribe((event) => this.record(event));

    try {
      await controller.start({
        conversationId: call.conversationId,
        backendDisplayName: call.backendDisplayName,
        startupContext: SPIKE_STARTUP_CONTEXT,
        instructionsSupplement: SPIKE_INSTRUCTIONS,
      });
      this.deps.notify("Voice transport check connected. Run the command again to end it.");
    } catch (error) {
      logWarn("[VoiceSpike] the call did not connect", {
        elapsedMs: this.elapsedMs(),
        errorName: error instanceof Error ? error.name : "unknown",
      });
      this.deps.notify(
        error instanceof Error
          ? `Voice transport check failed: ${error.message}`
          : "Voice transport check failed."
      );
      await this.stop();
    }
  }

  private async stop(): Promise<void> {
    const controller = this.controller;
    this.clearPending();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller = null;
    this.timers = null;
    if (!controller) return;
    await controller.close("voice transport check ended");
    logInfo("[VoiceSpike] finished", {
      elapsedMs: this.elapsedMs(),
      closureConfirmed: controller.getSnapshot().closureConfirmed,
      closeReason: controller.getSnapshot().closeReason,
    });
  }

  /**
   * Logs one event and drives delegation handling. Transcript text, tickets,
   * and SDP never reach the log — only identifiers, sizes, and timings.
   */
  private record(event: VoiceSessionEvent): void {
    switch (event.type) {
      case "state.changed":
        logInfo("[VoiceSpike] state", {
          elapsedMs: this.elapsedMs(),
          state: event.snapshot.state,
          controlOnly: event.snapshot.controlOnly,
          locallyMuted: event.snapshot.locallyMuted,
          inputCommandPending: event.snapshot.inputCommandPending,
          playbackActive: event.snapshot.playbackActive,
        });
        return;
      case "transcript.delta":
        logInfo("[VoiceSpike] transcript", {
          elapsedMs: this.elapsedMs(),
          role: event.delta.role,
          liveEventId: event.delta.liveEventId,
          deltaChars: event.delta.delta.length,
          startMs: event.delta.startMs,
          endMs: event.delta.endMs,
        });
        if (event.delta.role === "user") this.advanceWatermark(event.delta.endMs);
        return;
      case "delegation.requested":
        logInfo("[VoiceSpike] delegation requested", {
          elapsedMs: this.elapsedMs(),
          liveDelegationId: event.liveDelegationId,
          offsetMs: event.offsetMs,
          watermarkMs: this.transcriptWatermarkMs,
        });
        this.trackDelegation(event.liveDelegationId, event.offsetMs);
        return;
      case "session.warning":
        logInfo("[VoiceSpike] warning", {
          elapsedMs: this.elapsedMs(),
          secondsRemaining: event.secondsRemaining,
        });
        return;
      case "usage.updated":
        logInfo("[VoiceSpike] usage", {
          elapsedMs: this.elapsedMs(),
          connectedSeconds: event.usage.connectedSeconds,
          estimatedCostUsd: event.usage.estimatedCostUsd,
          source: event.usage.source,
        });
        return;
      case "session.closed":
        logInfo("[VoiceSpike] session closed", {
          elapsedMs: this.elapsedMs(),
          reason: event.reason,
          usageFinal: event.usageFinal,
          connectedSeconds: event.usage.connectedSeconds,
        });
        return;
      case "error":
        logWarn("[VoiceSpike] error", {
          elapsedMs: this.elapsedMs(),
          code: event.code,
          recoverable: event.recoverable,
        });
        return;
    }
  }

  private trackDelegation(liveDelegationId: string, offsetMs: number): void {
    const timers = this.timers;
    if (!timers || this.pending.has(liveDelegationId)) return;
    const pending: PendingDelegation = {
      liveDelegationId,
      offsetMs,
      settleTimer: null,
      giveUpTimer: timers.setTimeout(() => this.defer(liveDelegationId), TRANSCRIPT_MAX_WAIT_MS),
    };
    this.pending.set(liveDelegationId, pending);
    this.evaluate(pending);
  }

  private advanceWatermark(endMs: number): void {
    this.transcriptWatermarkMs = Math.max(this.transcriptWatermarkMs, endMs);
    for (const pending of this.pending.values()) this.evaluate(pending);
  }

  /**
   * Arms the settle timer once speech covers the delegation's audio offset.
   * A timer alone never authorizes a task: without transcript coverage the
   * delegation is deferred instead.
   */
  private evaluate(pending: PendingDelegation): void {
    const timers = this.timers;
    if (!timers || this.transcriptWatermarkMs < pending.offsetMs) return;
    if (pending.settleTimer !== null) timers.clearTimeout(pending.settleTimer);
    pending.settleTimer = timers.setTimeout(
      () => this.accept(pending.liveDelegationId),
      TRANSCRIPT_SETTLE_MS
    );
  }

  private accept(liveDelegationId: string): void {
    const pending = this.pending.get(liveDelegationId);
    const controller = this.controller;
    if (!pending || !controller) return;
    this.forget(pending);
    const taskId = this.deps.newTaskId();
    logInfo("[VoiceSpike] delegation accepted", {
      elapsedMs: this.elapsedMs(),
      liveDelegationId,
      taskId,
      watermarkMs: this.transcriptWatermarkMs,
    });
    controller.acceptDelegation(liveDelegationId, taskId);
    controller.updateTask({
      taskId,
      revision: 1,
      state: "completed",
      excerpt: SPIKE_RESULT_EXCERPT,
      liveDelegationId,
    });
  }

  private defer(liveDelegationId: string): void {
    const pending = this.pending.get(liveDelegationId);
    const controller = this.controller;
    if (!pending || !controller) return;
    this.forget(pending);
    logInfo("[VoiceSpike] delegation deferred", {
      elapsedMs: this.elapsedMs(),
      liveDelegationId,
      offsetMs: pending.offsetMs,
      watermarkMs: this.transcriptWatermarkMs,
    });
    controller.deferDelegation(liveDelegationId, "no-transcript");
  }

  private forget(pending: PendingDelegation): void {
    if (this.timers) {
      if (pending.settleTimer !== null) this.timers.clearTimeout(pending.settleTimer);
      this.timers.clearTimeout(pending.giveUpTimer);
    }
    this.pending.delete(pending.liveDelegationId);
  }

  private clearPending(): void {
    for (const pending of [...this.pending.values()]) this.forget(pending);
  }

  private elapsedMs(): number {
    return this.now() - this.startedAtMs;
  }
}
