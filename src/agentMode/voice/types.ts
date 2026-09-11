import type {
  StartupContextMessage,
  VoiceCloseReason,
  VoiceDelegationDeferralReason,
  VoiceErrorCode,
  VoiceTaskState,
  VoiceUsage,
} from "@/agentMode/voice/voiceProtocol";

/**
 * Lifecycle of the voice call itself. It says nothing about local agent work:
 * a completed call leaves running tasks untouched. See
 * `designdocs/VOICE_CHAT_DEMO_DESIGN.md` → "One conversation with two kinds of
 * assistant output".
 */
export type VoiceSessionState = "off" | "connecting" | "active" | "closing" | "error";

/**
 * Everything a UI needs to describe the call without inspecting the transport.
 * Snapshots are frozen and replaced only when a field changes, so subscribers
 * may compare by reference.
 */
export interface VoiceSessionSnapshot {
  readonly state: VoiceSessionState;
  /** Our application session id, available once the server created the call. */
  readonly voiceSessionId: string | null;
  /** The user asked not to send microphone content. Independent of playback. */
  readonly locallyMuted: boolean;
  /** A mute or unmute command is still waiting for the server's receipt. */
  readonly inputCommandPending: boolean;
  /** Remote audio is attached to the owning window and playing. */
  readonly playbackActive: boolean;
  /** Measured remote audio RMS, from zero (silence) to one. */
  readonly outputLevel?: number;
  /** Epoch milliseconds when the call became active, excluding connection setup. */
  readonly startedAtMs?: number;
  /** The call carries control events only because the server returned no SDP answer. */
  readonly controlOnly: boolean;
  /** Latest cumulative usage. Values replace earlier ones; they never add. */
  readonly usage: VoiceUsage | null;
  /** Last failure reported by the server or the local transport. */
  readonly errorCode: VoiceErrorCode | "transport" | null;
  /** Why the call ended, once the server said so. */
  readonly closeReason: VoiceCloseReason | null;
  /** False when closure was requested but never confirmed within the wait. */
  readonly closureConfirmed: boolean;
}

/**
 * One transcript fragment exactly as GPT-Live delivered it. `delta` is
 * verbatim: fragments are neither trimmed nor assumed to be sentences, and
 * grouping them into readable captions is presentation work done elsewhere.
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md` → "Transcript assembly".
 */
export interface VoiceTranscriptDelta {
  /** Our application session id, which scopes fragment identity. */
  readonly voiceSessionId: string;
  /** GPT-Live's event id, unique within the live session. */
  readonly liveEventId: string;
  /** Who was speaking: the person at the microphone or the voice frontend. */
  readonly role: "user" | "assistant";
  /** The fragment text, unmodified. */
  readonly delta: string;
  /** Session-relative start of the fragment's audio, in milliseconds. */
  readonly startMs: number;
  /** Session-relative end of the fragment's audio, in milliseconds. */
  readonly endMs: number;
}

/**
 * Application events the controller publishes. Receipt of any of them is
 * evidence about the call, never about local agent work.
 */
export type VoiceSessionEvent =
  | { readonly type: "state.changed"; readonly snapshot: VoiceSessionSnapshot }
  | { readonly type: "transcript.delta"; readonly delta: VoiceTranscriptDelta }
  | {
      readonly type: "delegation.requested";
      readonly liveDelegationId: string;
      readonly offsetMs: number;
    }
  | { readonly type: "session.warning"; readonly secondsRemaining: number }
  | { readonly type: "usage.updated"; readonly usage: VoiceUsage }
  | {
      readonly type: "session.closed";
      readonly reason: VoiceCloseReason;
      readonly usage: VoiceUsage;
      readonly usageFinal: boolean;
    }
  | {
      readonly type: "error";
      readonly code: VoiceErrorCode | "transport";
      readonly recoverable: boolean;
      readonly detail?: string;
    };

/** What a caller must supply to open a call for one conversation. */
export interface VoiceSessionStartRequest {
  /** The Copilot conversation the call belongs to. */
  conversationId: string;
  /** Human-readable name of the selected local agent, for spoken references. */
  backendDisplayName: string;
  /** Bounded recent conversation seeded into the live session. */
  startupContext: readonly StartupContextMessage[];
  /** Extra instructions appended to the voice frontend's own instructions. */
  instructionsSupplement?: string;
}

/** Factual progress for one local task, mirrored into the live conversation. */
export interface VoiceTaskUpdate {
  taskId: string;
  /** Increases per update for this task; the server ignores older revisions. */
  revision: number;
  state: VoiceTaskState;
  /** Bounded answer excerpt, explicitly not the full answer. */
  excerpt?: string;
  /** Short factual note, such as which tool is waiting for approval. */
  context?: string;
  /** Delegation the task came from, when it came from speech. */
  liveDelegationId?: string;
}

/** An accepted typed submission plus current UI facts to mirror into voice. */
export interface VoiceContextUpdate {
  submission?: {
    submissionId: string;
    taskId?: string;
    requestText: string;
  };
  facts?: readonly string[];
}

/** Why the client will not turn a delegation into a local task. */
export type VoiceDeferralReason = VoiceDelegationDeferralReason;

/**
 * The microphone as the controller uses it: capture can be silenced without
 * releasing the device, and releasing it clears the OS recording indicator.
 */
export interface VoiceMicrophone {
  /** Media stream offered to the peer connection before negotiation. */
  readonly stream: MediaStream;
  /** Silences or resumes capture, leaving the device open either way. */
  setEnabled(enabled: boolean): void;
  /** Stops every track so the operating system stops showing capture. */
  stop(): void;
}

/** Remote audio playback in the owning window. */
export interface VoicePlayback {
  /** Attaches the remote stream and starts playing it. */
  play(stream: MediaStream): void;
  /** Silences playback immediately and releases the audio element. */
  stop(): void;
}

/** A transcript fragment as it arrives on the WebRTC event channel. */
export interface LiveTranscriptEvent {
  type: "session.input_transcript.delta" | "session.output_transcript.delta";
  event_id: string;
  delta: string;
  start_ms: number;
  end_ms: number;
}

/**
 * The live session became usable. An applied SDP answer is not enough: the
 * provider starts producing transcripts and accepting commands only once this
 * event reaches the `oai-events` channel.
 */
export interface LiveSessionStartedEvent {
  type: "session.started";
  event_id: string;
}

/**
 * The provider accepted a mute or unmute command. This is the outcome of
 * `input.mute` / `input.unmute`; our own server's `ack` only reports that it
 * received the request.
 */
export interface LiveInputAudioStateEvent {
  type: "session.input_audio.muted" | "session.input_audio.unmuted";
  event_id: string;
}

/** Every `oai-events` event the controller consumes. Audio frames are not one. */
export type LiveChannelEvent =
  | LiveSessionStartedEvent
  | LiveTranscriptEvent
  | LiveInputAudioStateEvent;

/** Options for one WebRTC negotiation attempt. */
export interface VoiceLiveConnectOptions {
  /** Submits the local offer and resolves with the SDP answer. */
  exchangeSdp: (offer: string, options: { signal: AbortSignal }) => Promise<string>;
  /** Total setup deadline in milliseconds. */
  timeoutMs?: number;
}

/**
 * The peer connection and its `oai-events` data channel, reduced to what the
 * controller needs. The concrete implementation wraps the OpenAI SDK helper.
 */
export interface VoiceLiveConnection {
  /** Offers local capture to the peer before negotiation starts. */
  addMicrophone(stream: MediaStream): void;
  /** Reports the remote audio stream once the peer supplies it. */
  onRemoteStream(handler: (stream: MediaStream) => void): void;
  /**
   * Subscribes to the `oai-events` channel. Reflected audio frames are never
   * delivered here: they are large, they carry speech, and nothing local needs
   * them.
   */
  onEvent(handler: (event: LiveChannelEvent) => void): void;
  /** Negotiates once; resolves when media and the event channel are usable. */
  connect(options: VoiceLiveConnectOptions): Promise<void>;
  /** Releases the peer connection. Never stops caller-owned tracks. */
  close(): void;
}

/** Callbacks the control socket delivers to the controller. */
export interface VoiceControlSocketHandlers {
  /** The socket is writable; the controller sends its `auth` frame here. */
  onOpen(): void;
  /** One received text frame, unparsed. */
  onMessage(data: string): void;
  /** The socket closed, for any reason including our own request. */
  onClose(): void;
  /** A transport-level failure. Carries no server-supplied detail. */
  onError(): void;
}

/** The control WebSocket, reduced to what the controller needs. */
export interface VoiceControlSocket {
  send(payload: string): void;
  close(): void;
}

/** Request for one authenticated session creation. */
export interface VoiceCreationRequest {
  /** Absolute creation endpoint URL. */
  url: string;
  /** Bearer credential. Never logged, never placed in a URL. */
  credential: string;
  /** JSON body, already bounded by the caller. */
  body: string;
}

/**
 * Timers owned by the window the call runs in, so closing a popout cancels
 * everything still pending instead of firing against a dead document.
 */
export interface VoiceTimers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Everything the controller needs from the runtime it is running in. A real
 * host binds all of it to the window that owns the Copilot view; tests supply
 * fakes and never touch the DOM.
 */
export interface VoiceHost {
  /** Window-owned timers used for the terminal-confirmation wait. */
  readonly timers: VoiceTimers;
  /** Opens the microphone of the owning window with capture already silenced. */
  captureMicrophone(): Promise<VoiceMicrophone>;
  /** Creates the peer connection and its `oai-events` data channel. */
  createLiveConnection(): VoiceLiveConnection;
  /** Plays remote audio inside the owning window. */
  createPlayback(onOutputLevel?: (level: number) => void): VoicePlayback;
  /** Posts the SDP offer to the voice server and returns the parsed body. */
  createSession(request: VoiceCreationRequest): Promise<unknown>;
  /**
   * Releases a created session over HTTP. Used when no authenticated control
   * socket is left to carry `session.close`, so a call the server already
   * opened does not idle until its deadline.
   */
  deleteSession(request: { url: string; credential: string }): Promise<void>;
  /** Opens the control socket of the owning window. */
  openControlSocket(url: string, handlers: VoiceControlSocketHandlers): VoiceControlSocket;
}
