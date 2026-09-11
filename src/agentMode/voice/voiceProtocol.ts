/**
 * Copilot voice chat application protocol.
 *
 * Canonical source: `shared/voiceProtocol.ts` in the `zeroliu/copilot-voice`
 * server repository. Change it there first, then copy the file here.
 *
 * This file is the canonical definition of the wire contract between the
 * Copilot Obsidian plugin and the voice server. It is copied verbatim into the
 * plugin at `src/agentMode/voice/voiceProtocol.ts`; the two copies must stay
 * byte-identical.
 *
 * It must stay dependency-free — no imports at all, not even Node built-ins —
 * so the same source compiles unchanged inside the Obsidian desktop bundle and
 * inside the server's Node build.
 *
 * The protocol describes *application* state. OpenAI's own live session ID and
 * delegation ID are separate opaque identifiers that travel inside these
 * events; never reconstruct one from the other.
 */

/** Wire version carried by every application event. Bump on breaking change. */
export const VOICE_PROTOCOL_VERSION = 1;

/** Largest accepted WebSocket application frame, in bytes. */
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

/** Largest accepted session-creation HTTP body, in bytes. */
export const MAX_CREATION_BYTES = 256 * 1024;

/** Largest accepted SDP offer or answer, in characters. */
export const MAX_SDP_CHARS = 64 * 1024;

/** Largest accepted startup context list, in messages (OpenAI seeding limit). */
export const MAX_STARTUP_CONTEXT_MESSAGES = 128;

/** Largest accepted startup context payload, in characters across all entries. */
export const MAX_STARTUP_CONTEXT_CHARS = 24_000;

/** Largest accepted supplement to the voice frontend's instructions. */
export const MAX_INSTRUCTIONS_SUPPLEMENT_CHARS = 4_000;

/** Largest accepted bounded answer excerpt on a task update. */
export const MAX_TASK_EXCERPT_CHARS = 1_000;

/** Largest accepted single context fact string. */
export const MAX_CONTEXT_FACT_CHARS = 500;

/** Largest accepted number of context facts in one `context.updated`. */
export const MAX_CONTEXT_FACTS = 16;

/** Largest accepted identifier length, for every ID field in this protocol. */
export const MAX_ID_CHARS = 128;

/**
 * Why a voice session ended. Reported by the server on `session.closed`; every
 * reason is terminal and none of them implies anything about local agent work.
 */
export type VoiceCloseReason =
  /** The client asked for closure through `session.close` or `DELETE`. */
  | "client-requested"
  /** The configured maximum call duration elapsed. */
  | "deadline"
  /** The client stopped answering heartbeats. */
  | "client-timeout"
  /** The control socket never authenticated before its claim window expired. */
  | "unclaimed"
  /** The upstream live session ended or became unusable. */
  | "upstream-lost"
  /** The process is shutting down and released the call. */
  | "server-shutdown"
  /** The client sent something the server refuses to interpret. */
  | "protocol-violation"
  /** The client could not keep up with the outbound event stream. */
  | "queue-overflow"
  /** The server hit an unexpected fault and gave up on the call. */
  | "internal-error";

/**
 * Typed failure codes. `recoverable` on the event says whether voice can
 * continue; the code says what happened, and is safe to log.
 */
export type VoiceErrorCode =
  /** Missing or unrecognized bearer credential or control ticket. */
  | "unauthorized"
  /** Valid credential addressing a session it does not own. */
  | "forbidden"
  /** No such session, or it already ended. */
  | "not-found"
  /** Malformed request or event body. */
  | "invalid-request"
  /** Body or frame exceeded its documented size bound. */
  | "payload-too-large"
  /** Well-formed event arriving in a state that forbids it. */
  | "protocol-violation"
  /** First frame was not `auth` within the claim window. */
  | "auth-timeout"
  /** Deployment-wide concurrent call cap reached. */
  | "session-limit"
  /** This credential already owns an active call. */
  | "owner-busy"
  /** The live upstream refused or dropped the session. */
  | "upstream-failed"
  /** Outbound events accumulated past the bound for this connection. */
  | "queue-overflow"
  /** The server is shutting down and is no longer accepting work. */
  | "server-shutdown"
  /** Unexpected server fault. */
  | "internal";

/** Application-level state of one local agent task, as reported by the client. */
export type VoiceTaskState =
  | "queued"
  | "running"
  | "awaiting-user"
  | "completed"
  | "cancelled"
  | "failed"
  /** Reloaded or disconnected with no confirmed terminal outcome. */
  | "interrupted";

/** Why the client did not turn a delegation notification into a task. */
export type VoiceDelegationDeferralReason =
  /** No usable user speech had arrived for the delegation's audio offset. */
  | "no-transcript"
  /** Every source fragment was already claimed by an existing task. */
  | "already-claimed"
  /** No single local backend is selected, so no task can be created. */
  | "no-backend"
  /** The client declined for a reason it does not further classify. */
  | "declined";

/** Roles accepted in seeded startup context, matching the live API's roles. */
export type StartupContextRole = "developer" | "user" | "assistant";

/**
 * Cumulative usage for one call. These values are a maximum/latest observation,
 * never a sum of repeated usage reports, and never a bill.
 */
export interface VoiceUsage {
  /** Longest connected duration observed for this call, in seconds. */
  connectedSeconds: number;
  /** Estimated model spend in USD derived from `connectedSeconds`. */
  estimatedCostUsd: number;
  /** Whether the numbers came from our own clock or a provider usage report. */
  source: "local-clock" | "provider";
}

/** Fields present on every application event in either direction. */
export interface VoiceEventEnvelope {
  /** Always `VOICE_PROTOCOL_VERSION`; receivers reject anything else. */
  protocolVersion: typeof VOICE_PROTOCOL_VERSION;
  /** Unique ID for this event, used by `ack` and for deduplication. */
  eventId: string;
  /** The Copilot conversation this call belongs to. */
  conversationId: string;
  /** Our application session ID, not OpenAI's live session ID. */
  voiceSessionId: string;
}

/** Envelope plus the per-session monotonic ordering number on server events. */
export interface ServerEventEnvelope extends VoiceEventEnvelope {
  /** Strictly increasing from 1 within one voice session. */
  seq: number;
}

/** A live delegation signal. Carries no task text; the client builds that. */
export interface DelegationRequestedEvent extends ServerEventEnvelope {
  type: "delegation.requested";
  /** OpenAI's opaque delegation ID, echoed back on accept/defer. */
  liveDelegationId: string;
  /** Audio offset of the delegation within the call, in milliseconds. */
  offsetMs: number;
}

/** Terminal event for a call. Nothing follows it on this socket. */
export interface SessionClosedEvent extends ServerEventEnvelope {
  type: "session.closed";
  reason: VoiceCloseReason;
  usage: VoiceUsage;
  /** True only when the provider confirmed final accounting. */
  usageFinal: boolean;
}

/** The call is approaching a configured limit but is still usable. */
export interface SessionWarningEvent extends ServerEventEnvelope {
  type: "session.warning";
  /** The only warning the demo raises: the hard call deadline is near. */
  reason: "deadline-approaching";
  /** Whole seconds left before the server closes the call itself. */
  secondsRemaining: number;
}

/** Periodic usage snapshot. Values replace previous ones; they never add. */
export interface UsageUpdatedEvent extends ServerEventEnvelope {
  type: "usage.updated";
  usage: VoiceUsage;
}

/** Receipt for one received event. Receipt is not execution. */
export interface ServerAckEvent extends ServerEventEnvelope {
  type: "ack";
  /** `eventId` of the client event being acknowledged. */
  ackEventId: string;
}

/** A typed failure. `recoverable: false` is always followed by closure. */
export interface ServerErrorEvent extends ServerEventEnvelope {
  type: "error";
  code: VoiceErrorCode;
  /** Whether the call can continue after this error. */
  recoverable: boolean;
  /** Short non-sensitive explanation. Never contains user or secret content. */
  detail?: string;
}

/** Server liveness probe; the client answers with `pong`. */
export interface ServerPingEvent extends ServerEventEnvelope {
  type: "ping";
}

/** Server answer to a client `ping`. */
export interface ServerPongEvent extends ServerEventEnvelope {
  type: "pong";
}

/** Every event the server may send on the control socket. */
export type ServerEvent =
  | DelegationRequestedEvent
  | SessionClosedEvent
  | SessionWarningEvent
  | UsageUpdatedEvent
  | ServerAckEvent
  | ServerErrorEvent
  | ServerPingEvent
  | ServerPongEvent;

/** Mandatory first frame on the control socket. Nothing else is read before it. */
export interface AuthEvent extends VoiceEventEnvelope {
  type: "auth";
  /** The one-use short-lived ticket returned by session creation. */
  ticket: string;
}

/** The client mapped a delegation to a local task. Repeats return the same map. */
export interface DelegationAcceptedEvent extends VoiceEventEnvelope {
  type: "delegation.accepted";
  liveDelegationId: string;
  /** The client's task ID for the work this delegation produced. */
  taskId: string;
}

/** The client will not create a task for this delegation, and why. */
export interface DelegationDeferredEvent extends VoiceEventEnvelope {
  type: "delegation.deferred";
  liveDelegationId: string;
  reason: VoiceDelegationDeferralReason;
}

/** Sparse factual progress for one local task. Never raw tool output. */
export interface TaskUpdatedEvent extends VoiceEventEnvelope {
  type: "task.updated";
  taskId: string;
  /** Increases per update for this task; the server ignores older revisions. */
  revision: number;
  state: VoiceTaskState;
  /** Bounded answer excerpt, explicitly not the full answer. */
  excerpt?: string;
  /** Short factual note such as which tool is waiting for approval. */
  context?: string;
  /** Delegation this task came from, when it came from speech. */
  liveDelegationId?: string;
}

/** An accepted typed submission and current UI/task facts to mirror into voice. */
export interface ContextUpdatedEvent extends VoiceEventEnvelope {
  type: "context.updated";
  /** Present when the update reports a typed request the client accepted. */
  submission?: {
    /** The client's submission ID, distinct from any delegation ID. */
    submissionId: string;
    /** Task created for the submission, when one was created. */
    taskId?: string;
    /** The typed request text, bounded by `MAX_CONTEXT_FACT_CHARS`. */
    requestText: string;
  };
  /** Short factual statements about current UI or task state. */
  facts?: readonly string[];
}

/** Stop sending microphone content upstream. */
export interface InputMuteEvent extends VoiceEventEnvelope {
  type: "input.mute";
}

/** Resume sending microphone content upstream. */
export interface InputUnmuteEvent extends VoiceEventEnvelope {
  type: "input.unmute";
}

/** Ask the server to end the call. Idempotent; never touches local work. */
export interface SessionCloseEvent extends VoiceEventEnvelope {
  type: "session.close";
  /** Optional client-side reason, recorded in the close log. */
  reason?: string;
}

/** Client receipt for a server event. */
export interface ClientAckEvent extends VoiceEventEnvelope {
  type: "ack";
  ackEventId: string;
}

/** Client liveness probe; the server answers with `pong`. */
export interface ClientPingEvent extends VoiceEventEnvelope {
  type: "ping";
}

/** Client answer to a server `ping`. */
export interface ClientPongEvent extends VoiceEventEnvelope {
  type: "pong";
}

/** Every event the client may send on the control socket. */
export type ClientEvent =
  | AuthEvent
  | DelegationAcceptedEvent
  | DelegationDeferredEvent
  | TaskUpdatedEvent
  | ContextUpdatedEvent
  | InputMuteEvent
  | InputUnmuteEvent
  | SessionCloseEvent
  | ClientAckEvent
  | ClientPingEvent
  | ClientPongEvent;

/** One seeded conversation entry sent at session creation. */
export interface StartupContextMessage {
  role: StartupContextRole;
  /** Plain text. No audio, attachments, or vault file bodies. */
  content: string;
}

/** Body of `POST /v1/voice/sessions`. */
export interface CreateVoiceSessionRequest {
  /** Client-chosen ID; repeating it returns the same session, not a new call. */
  creationRequestId: string;
  /** The Copilot conversation this call belongs to. */
  conversationId: string;
  /** The client's WebRTC SDP offer. Never logged. */
  sdpOffer: string;
  /** Human-readable name of the selected local agent, for spoken references. */
  backendDisplayName: string;
  /** Bounded recent conversation seeded into the live session. */
  startupContext: readonly StartupContextMessage[];
  /** Extra instructions appended to the voice frontend's own instructions. */
  instructionsSupplement?: string;
}

/** Configured limits for the created call, so the client can show them. */
export interface VoiceSessionLimits {
  /** Hard deadline after which the server closes the call itself. */
  maxSessionSeconds: number;
  /** When the server emits `session.warning`. */
  warnAtSeconds: number;
}

/** Success body of `POST /v1/voice/sessions`. */
export interface CreateVoiceSessionResponse {
  /** Our application session ID, used in the control URL and every event. */
  voiceSessionId: string;
  /** SDP answer, or null when the upstream runs control-only (fake upstream). */
  sdpAnswer: string | null;
  /** One-use short-lived ticket for the control socket's `auth` frame. */
  controlTicket: string;
  /** ISO 8601 instant after which an unclaimed session is discarded. */
  expiresAt: string;
  limits: VoiceSessionLimits;
}

/** Error body returned by every failing HTTP endpoint. */
export interface VoiceHttpErrorBody {
  error: {
    code: VoiceErrorCode;
    /** Short non-sensitive explanation. Safe to show and to log. */
    message: string;
  };
}

/** Outcome of a runtime validator: either a typed value or a reason string. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(source: Record<string, unknown>, key: string): ParseResult<string> {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${key} must be a non-empty string`);
  }
  if (value.length > MAX_ID_CHARS) {
    return fail(`${key} exceeds ${MAX_ID_CHARS} characters`);
  }
  return { ok: true, value };
}

function readText(
  source: Record<string, unknown>,
  key: string,
  maxChars: number
): ParseResult<string> {
  const value = source[key];
  if (typeof value !== "string") {
    return fail(`${key} must be a string`);
  }
  if (value.length > maxChars) {
    return fail(`${key} exceeds ${maxChars} characters`);
  }
  return { ok: true, value };
}

function readOptionalText(
  source: Record<string, unknown>,
  key: string,
  maxChars: number
): ParseResult<string | undefined> {
  if (source[key] === undefined) {
    return { ok: true, value: undefined };
  }
  return readText(source, key, maxChars);
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number
): ParseResult<number> {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    return fail(`${key} must be an integer >= ${minimum}`);
  }
  return { ok: true, value };
}

function readMember<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): ParseResult<T> {
  const value = source[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return { ok: true, value: value as T };
}

const TASK_STATES: readonly VoiceTaskState[] = [
  "queued",
  "running",
  "awaiting-user",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
];

const DEFERRAL_REASONS: readonly VoiceDelegationDeferralReason[] = [
  "no-transcript",
  "already-claimed",
  "no-backend",
  "declined",
];

const STARTUP_ROLES: readonly StartupContextRole[] = ["developer", "user", "assistant"];

function readEnvelope(value: unknown): ParseResult<VoiceEventEnvelope & { type: string }> {
  if (!isRecord(value)) {
    return fail("event must be an object");
  }
  if (value.protocolVersion !== VOICE_PROTOCOL_VERSION) {
    return fail(`protocolVersion must be ${VOICE_PROTOCOL_VERSION}`);
  }
  if (typeof value.type !== "string" || value.type.length === 0) {
    return fail("type must be a non-empty string");
  }
  const eventId = readId(value, "eventId");
  if (!eventId.ok) return eventId;
  const conversationId = readId(value, "conversationId");
  if (!conversationId.ok) return conversationId;
  const voiceSessionId = readId(value, "voiceSessionId");
  if (!voiceSessionId.ok) return voiceSessionId;
  return {
    ok: true,
    value: {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      type: value.type,
      eventId: eventId.value,
      conversationId: conversationId.value,
      voiceSessionId: voiceSessionId.value,
    },
  };
}

/**
 * Validates one decoded client→server event.
 *
 * Rejects unknown event types and out-of-bound payloads rather than passing
 * them through, so the server never has to re-check field shapes.
 *
 * @param value Decoded JSON value received on the control socket.
 */
export function parseClientEvent(value: unknown): ParseResult<ClientEvent> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const source = value as Record<string, unknown>;
  const base = {
    protocolVersion: VOICE_PROTOCOL_VERSION as typeof VOICE_PROTOCOL_VERSION,
    eventId: envelope.value.eventId,
    conversationId: envelope.value.conversationId,
    voiceSessionId: envelope.value.voiceSessionId,
  };

  switch (envelope.value.type) {
    case "auth": {
      const ticket = readText(source, "ticket", MAX_ID_CHARS);
      if (!ticket.ok) return ticket;
      if (ticket.value.length === 0) return fail("ticket must be a non-empty string");
      return { ok: true, value: { ...base, type: "auth", ticket: ticket.value } };
    }
    case "delegation.accepted": {
      const liveDelegationId = readId(source, "liveDelegationId");
      if (!liveDelegationId.ok) return liveDelegationId;
      const taskId = readId(source, "taskId");
      if (!taskId.ok) return taskId;
      return {
        ok: true,
        value: {
          ...base,
          type: "delegation.accepted",
          liveDelegationId: liveDelegationId.value,
          taskId: taskId.value,
        },
      };
    }
    case "delegation.deferred": {
      const liveDelegationId = readId(source, "liveDelegationId");
      if (!liveDelegationId.ok) return liveDelegationId;
      const reason = readMember(source, "reason", DEFERRAL_REASONS);
      if (!reason.ok) return reason;
      return {
        ok: true,
        value: {
          ...base,
          type: "delegation.deferred",
          liveDelegationId: liveDelegationId.value,
          reason: reason.value,
        },
      };
    }
    case "task.updated": {
      const taskId = readId(source, "taskId");
      if (!taskId.ok) return taskId;
      const revision = readInteger(source, "revision", 0);
      if (!revision.ok) return revision;
      const state = readMember(source, "state", TASK_STATES);
      if (!state.ok) return state;
      const excerpt = readOptionalText(source, "excerpt", MAX_TASK_EXCERPT_CHARS);
      if (!excerpt.ok) return excerpt;
      const context = readOptionalText(source, "context", MAX_CONTEXT_FACT_CHARS);
      if (!context.ok) return context;
      let liveDelegationId: string | undefined;
      if (source.liveDelegationId !== undefined) {
        const parsed = readId(source, "liveDelegationId");
        if (!parsed.ok) return parsed;
        liveDelegationId = parsed.value;
      }
      return {
        ok: true,
        value: {
          ...base,
          type: "task.updated",
          taskId: taskId.value,
          revision: revision.value,
          state: state.value,
          ...(excerpt.value === undefined ? {} : { excerpt: excerpt.value }),
          ...(context.value === undefined ? {} : { context: context.value }),
          ...(liveDelegationId === undefined ? {} : { liveDelegationId }),
        },
      };
    }
    case "context.updated": {
      let submission: ContextUpdatedEvent["submission"];
      if (source.submission !== undefined) {
        if (!isRecord(source.submission)) return fail("submission must be an object");
        const submissionId = readId(source.submission, "submissionId");
        if (!submissionId.ok) return submissionId;
        const requestText = readText(source.submission, "requestText", MAX_CONTEXT_FACT_CHARS);
        if (!requestText.ok) return requestText;
        let taskId: string | undefined;
        if (source.submission.taskId !== undefined) {
          const parsed = readId(source.submission, "taskId");
          if (!parsed.ok) return parsed;
          taskId = parsed.value;
        }
        submission = {
          submissionId: submissionId.value,
          requestText: requestText.value,
          ...(taskId === undefined ? {} : { taskId }),
        };
      }
      let facts: readonly string[] | undefined;
      if (source.facts !== undefined) {
        if (!Array.isArray(source.facts)) return fail("facts must be an array");
        if (source.facts.length > MAX_CONTEXT_FACTS) {
          return fail(`facts exceeds ${MAX_CONTEXT_FACTS} entries`);
        }
        for (const fact of source.facts) {
          if (typeof fact !== "string") return fail("facts entries must be strings");
          if (fact.length > MAX_CONTEXT_FACT_CHARS) {
            return fail(`facts entry exceeds ${MAX_CONTEXT_FACT_CHARS} characters`);
          }
        }
        facts = source.facts as readonly string[];
      }
      if (submission === undefined && facts === undefined) {
        return fail("context.updated requires submission or facts");
      }
      return {
        ok: true,
        value: {
          ...base,
          type: "context.updated",
          ...(submission === undefined ? {} : { submission }),
          ...(facts === undefined ? {} : { facts }),
        },
      };
    }
    case "input.mute":
      return { ok: true, value: { ...base, type: "input.mute" } };
    case "input.unmute":
      return { ok: true, value: { ...base, type: "input.unmute" } };
    case "session.close": {
      const reason = readOptionalText(source, "reason", MAX_CONTEXT_FACT_CHARS);
      if (!reason.ok) return reason;
      return {
        ok: true,
        value: {
          ...base,
          type: "session.close",
          ...(reason.value === undefined ? {} : { reason: reason.value }),
        },
      };
    }
    case "ack": {
      const ackEventId = readId(source, "ackEventId");
      if (!ackEventId.ok) return ackEventId;
      return { ok: true, value: { ...base, type: "ack", ackEventId: ackEventId.value } };
    }
    case "ping":
      return { ok: true, value: { ...base, type: "ping" } };
    case "pong":
      return { ok: true, value: { ...base, type: "pong" } };
    default:
      return fail(`unknown client event type: ${envelope.value.type}`);
  }
}

function readUsage(value: unknown): ParseResult<VoiceUsage> {
  if (!isRecord(value)) return fail("usage must be an object");
  const connectedSeconds = value.connectedSeconds;
  if (typeof connectedSeconds !== "number" || !(connectedSeconds >= 0)) {
    return fail("usage.connectedSeconds must be a number >= 0");
  }
  const estimatedCostUsd = value.estimatedCostUsd;
  if (typeof estimatedCostUsd !== "number" || !(estimatedCostUsd >= 0)) {
    return fail("usage.estimatedCostUsd must be a number >= 0");
  }
  const source = readMember(value, "source", ["local-clock", "provider"] as const);
  if (!source.ok) return source;
  return { ok: true, value: { connectedSeconds, estimatedCostUsd, source: source.value } };
}

/**
 * Validates one decoded server→client event.
 *
 * The plugin uses this so a compromised or buggy server cannot inject shapes
 * the UI never expects, and so `seq` gaps are detectable.
 *
 * @param value Decoded JSON value received on the control socket.
 */
export function parseServerEvent(value: unknown): ParseResult<ServerEvent> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const source = value as Record<string, unknown>;
  const seq = readInteger(source, "seq", 1);
  if (!seq.ok) return seq;
  const base = {
    protocolVersion: VOICE_PROTOCOL_VERSION as typeof VOICE_PROTOCOL_VERSION,
    eventId: envelope.value.eventId,
    conversationId: envelope.value.conversationId,
    voiceSessionId: envelope.value.voiceSessionId,
    seq: seq.value,
  };

  switch (envelope.value.type) {
    case "delegation.requested": {
      const liveDelegationId = readId(source, "liveDelegationId");
      if (!liveDelegationId.ok) return liveDelegationId;
      const offsetMs = readInteger(source, "offsetMs", 0);
      if (!offsetMs.ok) return offsetMs;
      return {
        ok: true,
        value: {
          ...base,
          type: "delegation.requested",
          liveDelegationId: liveDelegationId.value,
          offsetMs: offsetMs.value,
        },
      };
    }
    case "session.closed": {
      const reason = readMember(source, "reason", [
        "client-requested",
        "deadline",
        "client-timeout",
        "unclaimed",
        "upstream-lost",
        "server-shutdown",
        "protocol-violation",
        "queue-overflow",
        "internal-error",
      ] as const);
      if (!reason.ok) return reason;
      const usage = readUsage(source.usage);
      if (!usage.ok) return usage;
      if (typeof source.usageFinal !== "boolean") {
        return fail("usageFinal must be a boolean");
      }
      return {
        ok: true,
        value: {
          ...base,
          type: "session.closed",
          reason: reason.value,
          usage: usage.value,
          usageFinal: source.usageFinal,
        },
      };
    }
    case "session.warning": {
      const reason = readMember(source, "reason", ["deadline-approaching"] as const);
      if (!reason.ok) return reason;
      const secondsRemaining = readInteger(source, "secondsRemaining", 0);
      if (!secondsRemaining.ok) return secondsRemaining;
      return {
        ok: true,
        value: {
          ...base,
          type: "session.warning",
          reason: reason.value,
          secondsRemaining: secondsRemaining.value,
        },
      };
    }
    case "usage.updated": {
      const usage = readUsage(source.usage);
      if (!usage.ok) return usage;
      return { ok: true, value: { ...base, type: "usage.updated", usage: usage.value } };
    }
    case "ack": {
      const ackEventId = readId(source, "ackEventId");
      if (!ackEventId.ok) return ackEventId;
      return { ok: true, value: { ...base, type: "ack", ackEventId: ackEventId.value } };
    }
    case "error": {
      const code = readMember(source, "code", [
        "unauthorized",
        "forbidden",
        "not-found",
        "invalid-request",
        "payload-too-large",
        "protocol-violation",
        "auth-timeout",
        "session-limit",
        "owner-busy",
        "upstream-failed",
        "queue-overflow",
        "server-shutdown",
        "internal",
      ] as const);
      if (!code.ok) return code;
      if (typeof source.recoverable !== "boolean") {
        return fail("recoverable must be a boolean");
      }
      const detail = readOptionalText(source, "detail", MAX_CONTEXT_FACT_CHARS);
      if (!detail.ok) return detail;
      return {
        ok: true,
        value: {
          ...base,
          type: "error",
          code: code.value,
          recoverable: source.recoverable,
          ...(detail.value === undefined ? {} : { detail: detail.value }),
        },
      };
    }
    case "ping":
      return { ok: true, value: { ...base, type: "ping" } };
    case "pong":
      return { ok: true, value: { ...base, type: "pong" } };
    default:
      return fail(`unknown server event type: ${envelope.value.type}`);
  }
}

/**
 * Validates a session-creation body.
 *
 * Enforces the startup-context message and character bounds here rather than in
 * the server so the plugin can refuse an oversized body before sending it.
 *
 * @param value Decoded JSON body of `POST /v1/voice/sessions`.
 */
export function parseCreateVoiceSessionRequest(
  value: unknown
): ParseResult<CreateVoiceSessionRequest> {
  if (!isRecord(value)) return fail("request body must be an object");
  const creationRequestId = readId(value, "creationRequestId");
  if (!creationRequestId.ok) return creationRequestId;
  const conversationId = readId(value, "conversationId");
  if (!conversationId.ok) return conversationId;
  const sdpOffer = readText(value, "sdpOffer", MAX_SDP_CHARS);
  if (!sdpOffer.ok) return sdpOffer;
  if (sdpOffer.value.length === 0) return fail("sdpOffer must be a non-empty string");
  const backendDisplayName = readText(value, "backendDisplayName", MAX_CONTEXT_FACT_CHARS);
  if (!backendDisplayName.ok) return backendDisplayName;
  const instructionsSupplement = readOptionalText(
    value,
    "instructionsSupplement",
    MAX_INSTRUCTIONS_SUPPLEMENT_CHARS
  );
  if (!instructionsSupplement.ok) return instructionsSupplement;

  if (!Array.isArray(value.startupContext)) {
    return fail("startupContext must be an array");
  }
  if (value.startupContext.length > MAX_STARTUP_CONTEXT_MESSAGES) {
    return fail(`startupContext exceeds ${MAX_STARTUP_CONTEXT_MESSAGES} messages`);
  }
  const startupContext: StartupContextMessage[] = [];
  let totalChars = 0;
  for (const entry of value.startupContext) {
    if (!isRecord(entry)) return fail("startupContext entries must be objects");
    const role = readMember(entry, "role", STARTUP_ROLES);
    if (!role.ok) return role;
    const content = readText(entry, "content", MAX_STARTUP_CONTEXT_CHARS);
    if (!content.ok) return content;
    totalChars += content.value.length;
    if (totalChars > MAX_STARTUP_CONTEXT_CHARS) {
      return fail(`startupContext exceeds ${MAX_STARTUP_CONTEXT_CHARS} characters`);
    }
    startupContext.push({ role: role.value, content: content.value });
  }

  return {
    ok: true,
    value: {
      creationRequestId: creationRequestId.value,
      conversationId: conversationId.value,
      sdpOffer: sdpOffer.value,
      backendDisplayName: backendDisplayName.value,
      startupContext,
      ...(instructionsSupplement.value === undefined
        ? {}
        : { instructionsSupplement: instructionsSupplement.value }),
    },
  };
}

/**
 * Validates a session-creation response.
 *
 * @param value Decoded JSON body returned by `POST /v1/voice/sessions`.
 */
export function parseCreateVoiceSessionResponse(
  value: unknown
): ParseResult<CreateVoiceSessionResponse> {
  if (!isRecord(value)) return fail("response body must be an object");
  const voiceSessionId = readId(value, "voiceSessionId");
  if (!voiceSessionId.ok) return voiceSessionId;
  const controlTicket = readText(value, "controlTicket", MAX_ID_CHARS);
  if (!controlTicket.ok) return controlTicket;
  if (controlTicket.value.length === 0) return fail("controlTicket must be non-empty");
  const expiresAt = readText(value, "expiresAt", MAX_ID_CHARS);
  if (!expiresAt.ok) return expiresAt;
  if (Number.isNaN(Date.parse(expiresAt.value))) {
    return fail("expiresAt must be an ISO 8601 instant");
  }
  let sdpAnswer: string | null = null;
  if (value.sdpAnswer !== null) {
    const parsed = readText(value, "sdpAnswer", MAX_SDP_CHARS);
    if (!parsed.ok) return parsed;
    sdpAnswer = parsed.value;
  }
  if (!isRecord(value.limits)) return fail("limits must be an object");
  const maxSessionSeconds = readInteger(value.limits, "maxSessionSeconds", 1);
  if (!maxSessionSeconds.ok) return maxSessionSeconds;
  const warnAtSeconds = readInteger(value.limits, "warnAtSeconds", 0);
  if (!warnAtSeconds.ok) return warnAtSeconds;
  return {
    ok: true,
    value: {
      voiceSessionId: voiceSessionId.value,
      sdpAnswer,
      controlTicket: controlTicket.value,
      expiresAt: expiresAt.value,
      limits: {
        maxSessionSeconds: maxSessionSeconds.value,
        warnAtSeconds: warnAtSeconds.value,
      },
    },
  };
}

/**
 * Builds the control-socket path for a session.
 *
 * @param voiceSessionId Application session ID returned by creation.
 */
export function controlSocketPath(voiceSessionId: string): string {
  return `/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/control`;
}
