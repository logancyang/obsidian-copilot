import { logInfo, logWarn } from "@/logger";
import type { AgentVoiceSettings } from "@/settings/model";
import {
  VOICE_PROTOCOL_VERSION,
  controlSocketPath,
  parseCreateVoiceSessionResponse,
  parseServerEvent,
  type ClientEvent,
  type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse,
  type VoiceEventEnvelope,
} from "@/agentMode/voice/voiceProtocol";
import type {
  LiveChannelEvent,
  LiveTranscriptEvent,
  VoiceContextUpdate,
  VoiceControlSocket,
  VoiceDeferralReason,
  VoiceHost,
  VoiceLiveConnection,
  VoiceMicrophone,
  VoicePlayback,
  VoiceSessionEvent,
  VoiceSessionSnapshot,
  VoiceSessionStartRequest,
  VoiceTaskUpdate,
} from "@/agentMode/voice/types";

/**
 * How long closure waits for the server's `session.closed` before reporting an
 * uncertain ending. Capture and playback stop before the wait starts, so this
 * delay is never audible. See `designdocs/VOICE_CHAT_DEMO_DESIGN.md` →
 * "Session startup and shutdown".
 */
const CLOSE_CONFIRMATION_TIMEOUT_MS = 5_000;

/**
 * How long readiness waits for `session.started` on the event channel after
 * media connects. An applied SDP answer means the transports work, not that
 * the live session accepts commands, so a provider that never starts has to
 * fail visibly instead of leaving the call connecting forever.
 */
const SESSION_STARTED_TIMEOUT_MS = 15_000;

/**
 * How long an acknowledged unmute waits for the provider's
 * `session.input_audio.unmuted` before capture resumes on the acknowledgment
 * alone. A control-only call has no event channel to deliver that outcome, and
 * a provider that stops reflecting it must not leave the microphone stuck off.
 */
const INPUT_CONFIRMATION_GRACE_MS = 1_500;

/**
 * Upper bound on remembered transcript fragment ids. Deduplication data is
 * scoped to one call and must not grow without limit during a long one.
 */
const MAX_REMEMBERED_TRANSCRIPT_IDS = 5_000;

/** Snapshot every call starts from and returns to. */
const OFF_SNAPSHOT: VoiceSessionSnapshot = Object.freeze({
  state: "off" as const,
  voiceSessionId: null,
  locallyMuted: false,
  inputCommandPending: false,
  playbackActive: false,
  controlOnly: false,
  usage: null,
  errorCode: null,
  closeReason: null,
  closureConfirmed: true,
});

/** Runtime and configuration the controller is constructed with. */
export interface VoiceSessionControllerDeps {
  /**
   * Media, playback, signalling, and the control socket, all bound to the
   * window that owns the Copilot view so a popout keeps working.
   */
  host: VoiceHost;
  /** Read at every `start()`, so editing settings never needs a new controller. */
  readSettings: () => AgentVoiceSettings;
  /** Supplies the demo bearer credential, or null when none is stored. */
  resolveCredential: () => string | null;
  /** Generates protocol event ids. Injected so tests can assert on frames. */
  newEventId: () => string;
  /** Wall clock used for duration logging only. */
  now?: () => number;
}

/** A mute or unmute command waiting for the provider's decision. */
interface PendingInputCommand {
  /** Microphone state the command asks for. */
  muted: boolean;
  /** Timer that lets an acknowledged command stand in for the provider's event. */
  graceTimer: number | null;
}

/** Signals that the server created a control-only call with no media path. */
class ControlOnlyUpstreamError extends Error {
  constructor() {
    super("The voice server returned no SDP answer; the call is control-only.");
    this.name = "ControlOnlyUpstreamError";
  }
}

/**
 * Owns the lifetime of one voice call: microphone capture, the WebRTC media
 * and event channel, and the authenticated control socket. It publishes
 * application events and a state snapshot, and it never owns local agent work
 * — closing a call cancels nothing in the vault.
 */
export class VoiceSessionController {
  private readonly listeners = new Set<(event: VoiceSessionEvent) => void>();
  private readonly pendingAcks = new Map<string, () => void>();
  private readonly seenTranscriptIds = new Set<string>();
  private readonly now: () => number;

  private snapshot: VoiceSessionSnapshot = OFF_SNAPSHOT;
  private request: VoiceSessionStartRequest | null = null;
  private creation: CreateVoiceSessionResponse | null = null;
  private microphone: VoiceMicrophone | null = null;
  private connection: VoiceLiveConnection | null = null;
  private playback: VoicePlayback | null = null;
  private socket: VoiceControlSocket | null = null;
  private remoteStream: MediaStream | null = null;
  private authenticated = false;
  private startedAtMs = 0;
  private closing: Promise<void> | null = null;
  private confirmClosure: (() => void) | null = null;
  private resolveControlReady: (() => void) | null = null;
  private rejectControlReady: ((error: Error) => void) | null = null;
  private confirmSessionStarted: (() => void) | null = null;
  private pendingInput: PendingInputCommand | null = null;
  /**
   * Counts start attempts. A `close()` during connection bumps it, so the
   * attempt still in flight can tell that its call was given up on.
   */
  private startGeneration = 0;
  /**
   * Session the server created, kept past `disposeTransports()` so closure can
   * still release an upstream call whose control socket never worked.
   */
  private createdSession: { voiceSessionId: string; serverUrl: string } | null = null;

  constructor(private readonly deps: VoiceSessionControllerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Current call state. Stable by reference until something actually changes. */
  getSnapshot(): VoiceSessionSnapshot {
    return this.snapshot;
  }

  /** Remote audio, for a waveform or a second sink. Null before media arrives. */
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /**
   * Receives every application event, including `state.changed`.
   *
   * @param listener Called synchronously; a throwing listener is logged and
   *   never prevents delivery to the others.
   */
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Opens one call: microphone, media, and the control socket. Resolves only
   * once the control path is authenticated and media is connected, in either
   * order, at which point capture is enabled.
   *
   * @param request Conversation identity, selected agent, and the bounded
   *   startup context seeded into the live session.
   */
  async start(request: VoiceSessionStartRequest): Promise<void> {
    if (this.snapshot.state !== "off") {
      throw new Error("A voice session is already running.");
    }
    const settings = this.deps.readSettings();
    if (!settings.enabled) {
      throw new Error("Voice is turned off in Copilot settings.");
    }
    const serverUrl = normalizeBaseUrl(settings.serverUrl);
    if (!serverUrl) {
      throw new Error("The voice server URL is not configured.");
    }
    if (!isSecureServerUrl(serverUrl)) {
      throw new Error("The voice server must use HTTPS, or run on this machine.");
    }
    const credential = this.deps.resolveCredential();
    if (!credential) {
      throw new Error("The voice server credential is not configured.");
    }

    this.request = request;
    this.startedAtMs = this.now();
    this.createdSession = null;
    const generation = ++this.startGeneration;
    this.snapshot = OFF_SNAPSHOT;
    this.patch({ state: "connecting" });
    logInfo("[Voice] connecting", {
      conversationId: request.conversationId,
      startupContextMessages: request.startupContext.length,
    });

    const controlReady = new Promise<void>((resolve, reject) => {
      this.resolveControlReady = resolve;
      this.rejectControlReady = reject;
    });
    const sessionStarted = this.awaitSessionStarted();

    try {
      const microphone = await this.deps.host.captureMicrophone();
      this.microphone = microphone;
      microphone.setEnabled(false);

      const connection = this.deps.host.createLiveConnection();
      this.connection = connection;
      connection.addMicrophone(microphone.stream);
      connection.onRemoteStream((stream) => this.attachRemoteStream(stream));
      connection.onEvent((event) => this.handleChannelEvent(event));

      const media = connection
        .connect({
          exchangeSdp: (offer) => this.exchangeSdp(serverUrl, credential, offer, request),
        })
        .then(
          // An applied SDP answer only proves the transports work. The live
          // session accepts commands and produces transcripts from
          // `session.started` onwards, so readiness waits for it too.
          () => sessionStarted,
          (error: unknown) => {
            // A control-only call negotiates no media at all, so the helper's
            // rejection is the expected outcome rather than a failure.
            if (this.creation?.sdpAnswer === null) {
              this.releaseMicrophone();
              // No event channel exists to deliver `session.started`, so the
              // readiness wait for it is retired rather than left to expire.
              this.confirmSessionStarted?.();
              return;
            }
            throw error;
          }
        );
      // Media failing before the control socket authenticates would otherwise
      // leave the readiness wait pending for the whole connect deadline.
      media.catch((error: unknown) => this.failControlReady(error));

      await Promise.all([media, controlReady]);
    } catch (error) {
      // A superseded attempt owns nothing: whoever bumped the generation has
      // already released the transports and settled the call's state.
      if (generation !== this.startGeneration) throw error;
      // Back to `off`, not `error`: the call never opened, and parking the
      // controller in a state `start()` refuses would make the failure
      // permanent. `errorCode` still reports what went wrong.
      this.patch({ state: "off", errorCode: this.snapshot.errorCode ?? "transport" });
      this.releaseMicrophone();
      this.disposeTransports();
      logWarn("[Voice] failed to connect", {
        conversationId: request.conversationId,
        elapsedMs: this.now() - this.startedAtMs,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }

    if (generation !== this.startGeneration) {
      throw new Error("The voice session was closed while connecting.");
    }
    this.patch({ state: "active", startedAtMs: this.now() });
    if (!this.snapshot.locallyMuted) this.microphone?.setEnabled(true);
    logInfo("[Voice] active", {
      voiceSessionId: this.snapshot.voiceSessionId,
      controlOnly: this.snapshot.controlOnly,
      setupMs: this.now() - this.startedAtMs,
    });
  }

  /**
   * Turns the microphone off or back on. Muting silences capture at once;
   * unmuting resumes capture only after the server acknowledges the command,
   * so the button can distinguish "muted" from "waiting for the server".
   *
   * @param muted Whether the user wants microphone content suppressed.
   */
  setMuted(muted: boolean): void {
    // Muting silences the track but never stops it: the peer must keep sending
    // media for the whole call, or the server's context updates never reach the
    // live session.
    if (muted) this.microphone?.setEnabled(false);
    if (!this.authenticated || this.socket === null) {
      this.patch({ locallyMuted: muted, inputCommandPending: false });
      if (!muted && this.snapshot.state === "active") this.microphone?.setEnabled(true);
      return;
    }
    this.clearPendingInput();
    const eventId = this.deps.newEventId();
    this.pendingInput = { muted, graceTimer: null };
    this.pendingAcks.set(eventId, () => this.onInputCommandAcknowledged(muted));
    this.patch({ inputCommandPending: true, ...(muted ? { locallyMuted: true } : {}) });
    this.send({
      ...this.envelope(eventId),
      type: muted ? "input.mute" : "input.unmute",
    });
  }

  /**
   * Ends the call. Capture and playback stop immediately; the channels stay up
   * briefly so the server's terminal frame can still arrive. Repeated calls
   * join the closure already in flight.
   *
   * @param reason Short non-sensitive note recorded in the server's close log.
   */
  async close(reason?: string): Promise<void> {
    if (this.closing) return this.closing;
    if (this.snapshot.state === "off" && this.createdSession === null) return;
    // A start still negotiating must not come up behind this closure.
    this.startGeneration += 1;
    this.failControlReady(new Error("The voice session was closed while connecting."));
    this.closing = this.runClose(reason).finally(() => {
      this.closing = null;
    });
    return this.closing;
  }

  /**
   * Reports that a spoken request became a local task. Repeating a delegation
   * id returns the client's existing mapping rather than starting new work.
   *
   * @param liveDelegationId GPT-Live's opaque delegation id.
   * @param taskId The local task the delegation produced.
   */
  acceptDelegation(liveDelegationId: string, taskId: string): void {
    this.send({
      ...this.envelope(this.deps.newEventId()),
      type: "delegation.accepted",
      liveDelegationId,
      taskId,
    });
  }

  /**
   * Reports that no task was created for a delegation, so the voice frontend
   * can say nothing is running instead of implying work started.
   *
   * @param liveDelegationId GPT-Live's opaque delegation id.
   * @param reason Why the client declined to create a task.
   */
  deferDelegation(liveDelegationId: string, reason: VoiceDeferralReason): void {
    this.send({
      ...this.envelope(this.deps.newEventId()),
      type: "delegation.deferred",
      liveDelegationId,
      reason,
    });
  }

  /**
   * Mirrors factual task progress into the live conversation. Never send raw
   * tool output or private reasoning: anything sent here can be spoken.
   *
   * @param update Task identity, revision, state, and bounded excerpt.
   */
  updateTask(update: VoiceTaskUpdate): void {
    this.send({ ...this.envelope(this.deps.newEventId()), type: "task.updated", ...update });
  }

  /**
   * Mirrors an accepted typed submission and current UI facts into the live
   * conversation, so speech knows about work the user started by typing.
   *
   * @param update The accepted submission and any short factual statements.
   */
  updateContext(update: VoiceContextUpdate): void {
    this.send({ ...this.envelope(this.deps.newEventId()), type: "context.updated", ...update });
  }

  /** Resolves on `session.started`, or fails once the provider is overdue. */
  private awaitSessionStarted(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = this.deps.host.timers.setTimeout(() => {
        this.confirmSessionStarted = null;
        reject(new Error("The live session never reported that it started."));
      }, SESSION_STARTED_TIMEOUT_MS);
      this.confirmSessionStarted = () => {
        this.deps.host.timers.clearTimeout(timer);
        this.confirmSessionStarted = null;
        resolve();
      };
    });
  }

  private async exchangeSdp(
    serverUrl: string,
    credential: string,
    offer: string,
    request: VoiceSessionStartRequest
  ): Promise<string> {
    const body: CreateVoiceSessionRequest = {
      creationRequestId: this.deps.newEventId(),
      conversationId: request.conversationId,
      sdpOffer: offer,
      backendDisplayName: request.backendDisplayName,
      startupContext: request.startupContext,
      ...(request.instructionsSupplement
        ? { instructionsSupplement: request.instructionsSupplement }
        : {}),
    };
    const raw = await this.deps.host.createSession({
      url: `${serverUrl}/v1/voice/sessions`,
      credential,
      body: JSON.stringify(body),
    });
    const parsed = parseCreateVoiceSessionResponse(raw);
    if (!parsed.ok) {
      throw new Error(`The voice server returned an unusable session: ${parsed.error}`);
    }
    const created = parsed.value;
    this.creation = created;
    this.createdSession = { voiceSessionId: created.voiceSessionId, serverUrl };
    this.patch({
      voiceSessionId: created.voiceSessionId,
      controlOnly: created.sdpAnswer === null,
    });
    logInfo("[Voice] session created", {
      voiceSessionId: created.voiceSessionId,
      controlOnly: created.sdpAnswer === null,
      maxSessionSeconds: created.limits.maxSessionSeconds,
      elapsedMs: this.now() - this.startedAtMs,
    });
    // Claim the control socket as soon as the ticket exists so control
    // authentication and media negotiation can finish in either order.
    this.openControl(serverUrl, created);
    if (created.sdpAnswer === null) throw new ControlOnlyUpstreamError();
    return created.sdpAnswer;
  }

  private openControl(serverUrl: string, created: CreateVoiceSessionResponse): void {
    const url = `${toWebSocketBase(serverUrl)}${controlSocketPath(created.voiceSessionId)}`;
    this.socket = this.deps.host.openControlSocket(url, {
      onOpen: () => this.authenticate(created.controlTicket),
      onMessage: (data) => this.handleControlMessage(data),
      onClose: () => this.handleControlClosed(),
      onError: () => this.handleControlError(),
    });
  }

  private authenticate(ticket: string): void {
    const eventId = this.deps.newEventId();
    this.pendingAcks.set(eventId, () => {
      this.authenticated = true;
      logInfo("[Voice] control authenticated", {
        voiceSessionId: this.snapshot.voiceSessionId,
        elapsedMs: this.now() - this.startedAtMs,
      });
      this.resolveControlReady?.();
    });
    this.writeFrame({ ...this.envelope(eventId), type: "auth", ticket });
  }

  private handleControlMessage(data: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      logWarn("[Voice] discarded a control frame that was not JSON");
      return;
    }
    const parsed = parseServerEvent(decoded);
    if (!parsed.ok) {
      logWarn("[Voice] discarded an invalid control frame", { reason: parsed.error });
      return;
    }
    const event = parsed.value;
    if (event.voiceSessionId !== this.snapshot.voiceSessionId) {
      logWarn("[Voice] discarded a frame addressed to another session", { seq: event.seq });
      return;
    }

    switch (event.type) {
      case "ack": {
        const pending = this.pendingAcks.get(event.ackEventId);
        if (!pending) return;
        this.pendingAcks.delete(event.ackEventId);
        pending();
        return;
      }
      case "ping":
        this.writeFrame({ ...this.envelope(this.deps.newEventId()), type: "pong" });
        return;
      case "pong":
        return;
      case "delegation.requested":
        this.emit({
          type: "delegation.requested",
          liveDelegationId: event.liveDelegationId,
          offsetMs: event.offsetMs,
        });
        return;
      case "session.warning":
        logInfo("[Voice] deadline approaching", {
          voiceSessionId: event.voiceSessionId,
          secondsRemaining: event.secondsRemaining,
        });
        this.emit({ type: "session.warning", secondsRemaining: event.secondsRemaining });
        return;
      case "usage.updated":
        this.patch({ usage: event.usage });
        this.emit({ type: "usage.updated", usage: event.usage });
        return;
      case "session.closed":
        // The upstream call is gone, so nothing is left to release over HTTP.
        this.createdSession = null;
        this.patch({ usage: event.usage, closeReason: event.reason });
        this.emit({
          type: "session.closed",
          reason: event.reason,
          usage: event.usage,
          usageFinal: event.usageFinal,
        });
        this.confirmClosure?.();
        // A server-initiated closure (deadline, shutdown, liveness) has no
        // local closure in flight to dispose the transports for it.
        if (!this.closing) {
          this.releaseMicrophone();
          this.disposeTransports();
          this.patch({ state: "off", closureConfirmed: true });
        }
        return;
      case "error":
        logWarn("[Voice] server reported an error", {
          code: event.code,
          recoverable: event.recoverable,
        });
        this.patch({ errorCode: event.code });
        this.emit({
          type: "error",
          code: event.code,
          recoverable: event.recoverable,
          ...(event.detail ? { detail: event.detail } : {}),
        });
        // The provider refuses a mute or unmute through this code, and an
        // in-flight input command is the only thing it can be about while one
        // is outstanding.
        if (event.code === "upstream-failed") this.rejectPendingInput();
        if (!event.recoverable) this.failControlReady(new Error(`voice error: ${event.code}`));
        return;
    }
  }

  private handleControlClosed(): void {
    this.socket = null;
    this.authenticated = false;
    this.confirmClosure?.();
    this.rejectPendingAcks();
    if (this.snapshot.state === "connecting") {
      this.failControlReady(new Error("The control socket closed before authentication."));
      return;
    }
    // Closure closes this socket itself, and an ended call has nothing left to
    // lose; only an active call is losing something it still needs.
    if (this.snapshot.state !== "active") return;
    // The server ends the upstream call when the control socket drops, so the
    // media path is already talking to a call nobody is coordinating. Report
    // it and tear the rest down rather than leaving a live microphone.
    logWarn("[Voice] the control socket dropped during a call", {
      voiceSessionId: this.snapshot.voiceSessionId,
    });
    this.patch({ errorCode: "transport" });
    this.emit({ type: "error", code: "transport", recoverable: false });
    void this.close("control-lost");
  }

  /**
   * A socket error always precedes a close, and closure is where the call's
   * fate is decided, so this only records the diagnostic.
   */
  private handleControlError(): void {
    logWarn("[Voice] control socket reported a transport error", {
      voiceSessionId: this.snapshot.voiceSessionId,
    });
  }

  private handleChannelEvent(event: LiveChannelEvent): void {
    switch (event.type) {
      case "session.started":
        // Logged here rather than where the wait resolves: closure and a
        // control-only call retire that wait too, and a log line claiming the
        // live session started would then be describing a session that never did.
        logInfo("[Voice] live session started", {
          voiceSessionId: this.snapshot.voiceSessionId,
          elapsedMs: this.now() - this.startedAtMs,
        });
        this.confirmSessionStarted?.();
        return;
      case "session.input_audio.muted":
      case "session.input_audio.unmuted":
        this.settleInputCommand(event.type === "session.input_audio.muted");
        return;
      default:
        this.handleTranscript(event);
    }
  }

  private handleTranscript(event: LiveTranscriptEvent): void {
    const voiceSessionId = this.snapshot.voiceSessionId;
    if (voiceSessionId === null) return;
    const key = `${voiceSessionId}:${event.event_id}`;
    if (this.seenTranscriptIds.has(key)) return;
    if (this.seenTranscriptIds.size >= MAX_REMEMBERED_TRANSCRIPT_IDS) {
      const oldest = this.seenTranscriptIds.values().next();
      if (!oldest.done) this.seenTranscriptIds.delete(oldest.value);
    }
    this.seenTranscriptIds.add(key);
    this.emit({
      type: "transcript.delta",
      delta: {
        voiceSessionId,
        liveEventId: event.event_id,
        role: event.type === "session.input_transcript.delta" ? "user" : "assistant",
        delta: event.delta,
        startMs: event.start_ms,
        endMs: event.end_ms,
      },
    });
  }

  private attachRemoteStream(stream: MediaStream): void {
    this.remoteStream = stream;
    this.playback?.stop();
    this.playback = this.deps.host.createPlayback((outputLevel) => this.patch({ outputLevel }));
    this.playback.play(stream);
    this.patch({ playbackActive: true });
  }

  /**
   * Our server acknowledges receipt before it has forwarded the command, so an
   * acknowledged unmute keeps capture off and waits for the provider's own
   * `session.input_audio.unmuted`. The grace timer keeps a call whose event
   * channel does not deliver that outcome from stranding the microphone.
   */
  private onInputCommandAcknowledged(muted: boolean): void {
    const pending = this.pendingInput;
    if (!pending || pending.muted !== muted) return;
    pending.graceTimer = this.deps.host.timers.setTimeout(() => {
      logWarn("[Voice] applying an input command on receipt alone", {
        voiceSessionId: this.snapshot.voiceSessionId,
        muted,
      });
      this.settleInputCommand(muted);
    }, INPUT_CONFIRMATION_GRACE_MS);
  }

  /** Applies the provider's decision about the microphone. */
  private settleInputCommand(muted: boolean): void {
    const pending = this.pendingInput;
    if (!pending || pending.muted !== muted) return;
    this.clearPendingInput();
    this.patch({ locallyMuted: muted, inputCommandPending: false });
    if (!muted && this.snapshot.state === "active") this.microphone?.setEnabled(true);
    logInfo("[Voice] input state", {
      voiceSessionId: this.snapshot.voiceSessionId,
      muted,
    });
  }

  /**
   * Abandons a mute or unmute the provider rejected. Capture stays off, and
   * the snapshot reports the microphone as muted, because a failed unmute must
   * never be shown as a live microphone.
   */
  private rejectPendingInput(): void {
    const pending = this.pendingInput;
    if (!pending) return;
    this.clearPendingInput();
    this.microphone?.setEnabled(false);
    this.patch({ locallyMuted: true, inputCommandPending: false });
    logWarn("[Voice] the provider refused an input command", {
      voiceSessionId: this.snapshot.voiceSessionId,
      requestedMuted: pending.muted,
    });
  }

  private clearPendingInput(): void {
    if (this.pendingInput?.graceTimer !== null && this.pendingInput !== null) {
      this.deps.host.timers.clearTimeout(this.pendingInput.graceTimer);
    }
    this.pendingInput = null;
  }

  private async runClose(reason?: string): Promise<void> {
    this.patch({ state: "closing" });
    const confirmed = this.requestServerClosure(reason);
    // Capture and playback stop as soon as closure is requested, so the
    // operating system's microphone indicator clears immediately, while the
    // peer connection and event channel stay up for the terminal frame.
    this.releaseMicrophone();
    this.playback?.stop();
    this.playback = null;
    this.patch({ playbackActive: false, outputLevel: 0 });

    const closureConfirmed = await confirmed;
    this.disposeTransports();
    this.patch({ state: "off", closureConfirmed });
    if (!closureConfirmed) {
      logWarn("[Voice] closed without server confirmation", {
        voiceSessionId: this.snapshot.voiceSessionId,
      });
    }
    logInfo("[Voice] closed", {
      voiceSessionId: this.snapshot.voiceSessionId,
      confirmed: closureConfirmed,
      closeReason: this.snapshot.closeReason,
      durationMs: this.now() - this.startedAtMs,
    });
  }

  private requestServerClosure(reason?: string): Promise<boolean> {
    if (!this.authenticated || this.socket === null) return this.releaseCreatedSession();
    return new Promise<boolean>((resolve) => {
      const timer = this.deps.host.timers.setTimeout(() => {
        this.confirmClosure = null;
        resolve(false);
      }, CLOSE_CONFIRMATION_TIMEOUT_MS);
      this.confirmClosure = () => {
        this.deps.host.timers.clearTimeout(timer);
        this.confirmClosure = null;
        resolve(true);
      };
      this.send({
        ...this.envelope(this.deps.newEventId()),
        type: "session.close",
        ...(reason ? { reason } : {}),
      });
    });
  }

  /**
   * Ends a call that has no usable control socket through the authenticated
   * `DELETE` fallback, so an upstream session the server already opened is not
   * left billing until its deadline. Closure stays unconfirmed either way: the
   * endpoint is idempotent and says nothing about the call it released.
   */
  private async releaseCreatedSession(): Promise<boolean> {
    const created = this.createdSession;
    this.createdSession = null;
    if (created === null) return true;
    const credential = this.deps.resolveCredential();
    if (credential === null) return false;
    try {
      await this.deps.host.deleteSession({
        url: `${created.serverUrl}/v1/voice/sessions/${encodeURIComponent(created.voiceSessionId)}`,
        credential,
      });
      logInfo("[Voice] released the session over HTTP", {
        voiceSessionId: created.voiceSessionId,
      });
    } catch (error) {
      logWarn("[Voice] could not release the session over HTTP", {
        voiceSessionId: created.voiceSessionId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
    return false;
  }

  private disposeTransports(): void {
    this.rejectPendingAcks();
    this.clearPendingInput();
    // Retires the readiness wait so its deadline cannot fire against a call
    // that no longer exists.
    this.confirmSessionStarted?.();
    this.socket?.close();
    this.socket = null;
    this.connection?.close();
    this.connection = null;
    this.playback?.stop();
    this.playback = null;
    this.remoteStream = null;
    this.seenTranscriptIds.clear();
    this.authenticated = false;
    this.creation = null;
    this.request = null;
    this.resolveControlReady = null;
    this.rejectControlReady = null;
    this.patch({ inputCommandPending: false, playbackActive: false, outputLevel: 0 });
  }

  private releaseMicrophone(): void {
    this.microphone?.stop();
    this.microphone = null;
  }

  private rejectPendingAcks(): void {
    this.pendingAcks.clear();
  }

  private failControlReady(error: unknown): void {
    const reject = this.rejectControlReady;
    this.rejectControlReady = null;
    this.resolveControlReady = null;
    reject?.(error instanceof Error ? error : new Error(String(error)));
  }

  private envelope(eventId: string): VoiceEventEnvelope {
    return {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      eventId,
      conversationId: this.request?.conversationId ?? "",
      voiceSessionId: this.snapshot.voiceSessionId ?? "",
    };
  }

  /** Writes an application event, refusing to speak before authentication. */
  private send(event: ClientEvent): void {
    if (!this.authenticated) {
      logWarn("[Voice] dropped an event sent before the control socket was ready", {
        eventType: event.type,
      });
      return;
    }
    this.writeFrame(event);
  }

  private writeFrame(event: ClientEvent): void {
    if (this.socket === null) {
      logWarn("[Voice] dropped an event with no control socket", { eventType: event.type });
      return;
    }
    this.socket.send(JSON.stringify(event));
  }

  private patch(partial: Partial<VoiceSessionSnapshot>): void {
    const next: VoiceSessionSnapshot = Object.freeze({ ...this.snapshot, ...partial });
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    this.emit({ type: "state.changed", snapshot: next });
  }

  private emit(event: VoiceSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logWarn("[Voice] a subscriber threw", error);
      }
    }
  }
}

/** Trailing slashes would produce `//v1/...` paths the server does not route. */
function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * The bearer credential travels on the creation request, so plain HTTP would
 * put it on the wire in the clear. Loopback is exempt: it never leaves the
 * machine, and the local fake server runs there.
 */
function isSecureServerUrl(base: string): boolean {
  if (base.startsWith("https://")) return true;
  if (!base.startsWith("http://")) return false;
  const host = base.slice("http://".length).split(/[:/]/)[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** The control socket shares the creation endpoint's origin and scheme family. */
function toWebSocketBase(httpBase: string): string {
  if (httpBase.startsWith("https://")) return `wss://${httpBase.slice("https://".length)}`;
  if (httpBase.startsWith("http://")) return `ws://${httpBase.slice("http://".length)}`;
  return httpBase;
}

function sameSnapshot(a: VoiceSessionSnapshot, b: VoiceSessionSnapshot): boolean {
  return (
    a.state === b.state &&
    a.voiceSessionId === b.voiceSessionId &&
    a.locallyMuted === b.locallyMuted &&
    a.inputCommandPending === b.inputCommandPending &&
    a.playbackActive === b.playbackActive &&
    a.outputLevel === b.outputLevel &&
    a.startedAtMs === b.startedAtMs &&
    a.controlOnly === b.controlOnly &&
    a.usage === b.usage &&
    a.errorCode === b.errorCode &&
    a.closeReason === b.closeReason &&
    a.closureConfirmed === b.closureConfirmed
  );
}
