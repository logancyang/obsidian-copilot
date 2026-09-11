import type { AgentTaskAcceptance } from "@/agentMode/session/AgentTaskCoordinator";
import type { BackendId, PromptContent } from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";

/**
 * Neutral application vocabulary for a conversation that mixes typed input,
 * spoken input, and backend work. These describe Copilot's own state — they
 * are not a mirror of any voice provider's wire events, and nothing here may
 * grow provider-specific fields.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Copilot domain contracts".
 */

/** Who produced a conversation entry. Absent on entries written before voice existed. */
export type AgentMessageOrigin = "typed" | "voice-user" | "voice-assistant" | "backend";

/**
 * Where an entry is rendered: inline in the public conversation, or folded into
 * the detail body of a task card.
 */
export type AgentMessagePresentation = "conversation" | "task-detail";

/** How a task's request reached Copilot. */
export type AgentTaskSource = "typed" | "voice";

/**
 * How a task renders for its whole life. Captured at submission so toggling
 * voice later never moves a historical answer or redirects late chunks into a
 * newer speech bubble.
 */
export type AgentTaskPresentation = "text" | "voice-card";

/**
 * Lifecycle of one unit of backend work. `interrupted` is reserved for work
 * reloaded with no confirmed terminal outcome — a crash or reload cannot prove
 * the agent did nothing, so it is neither `completed` nor `failed`.
 */
export type AgentTaskState =
  | "queued"
  | "running"
  | "awaiting-user"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

/** The subset of {@link AgentTaskState} a settled task can hold. */
export type AgentTaskTerminalState = Extract<
  AgentTaskState,
  "completed" | "cancelled" | "failed" | "interrupted"
>;

/**
 * Lifecycle of the spoken channel. Deliberately separate from
 * {@link AgentTaskState}: backend work outlives a voice call and a live call
 * says nothing about whether any task is running.
 */
export type VoiceSessionState = "off" | "connecting" | "active" | "closing" | "error";

/**
 * Cumulative usage for the current call. Each report replaces the previous
 * one — these are a latest observation, never a sum and never a bill.
 */
export interface AgentVoiceUsage {
  connectedSeconds: number;
  estimatedCostUsd: number;
  /** Whether the provider confirmed the final accounting. */
  confirmed: boolean;
}

/**
 * Everything the chat UI needs to describe the spoken channel, read from the
 * same snapshot as messages and tasks so a render can never mix a stale voice
 * state with fresh task state. Mute and playback are flags rather than states:
 * a muted microphone is legal in an otherwise `active` call.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Mode and control behavior".
 */
export interface AgentVoiceRuntimeState {
  readonly session: VoiceSessionState;
  /** Local microphone capture is suppressed. */
  readonly inputMuted: boolean;
  /** A mute or unmute command has not been answered yet. */
  readonly inputCommandPending: boolean;
  /** Remote speech is attached and playing in the owning window. */
  readonly playbackActive: boolean;
  readonly usage: AgentVoiceUsage | null;
  /** Seconds left before the call's hard deadline, once the server warns. */
  readonly secondsRemainingWarning: number | null;
  /** Last failure the call reported, for a UI that must name the problem. */
  readonly errorCode: string | null;
  /**
   * Spoken requests parked behind the running turn, one short line each. The
   * UI says plainly that they have not changed the running task.
   */
  readonly queuedFollowUps: readonly string[];
}

/** Frozen "no queued follow-ups" slice; keeps an idle snapshot stable. */
export const EMPTY_VOICE_FOLLOW_UPS: readonly string[] = Object.freeze([]);

/** The state every conversation reports until a call is actually running. */
export const VOICE_OFF_RUNTIME_STATE: AgentVoiceRuntimeState = Object.freeze({
  session: "off",
  inputMuted: false,
  inputCommandPending: false,
  playbackActive: false,
  usage: null,
  secondsRemainingWarning: null,
  errorCode: null,
  queuedFollowUps: EMPTY_VOICE_FOLLOW_UPS,
});

/**
 * What starting voice did. A refusal carries the sentence the UI shows, so the
 * user learns why voice is unavailable instead of watching a dead button.
 */
export type AgentVoiceStartOutcome = { started: true } | { started: false; reason: string };

/**
 * The spoken channel as one conversation's UI drives it. The implementation
 * lives in the transport layer and is handed to the chat through
 * `AgentChatUIState.attachVoice`, so the UI never imports a transport.
 */
export interface AgentVoiceControls {
  /** Current call state for this conversation. Stable by reference. */
  getState(): AgentVoiceRuntimeState;
  /** Fires whenever {@link getState} would return something new. */
  subscribe(listener: () => void): () => void;
  /** Open a call for this conversation, or report why it cannot open. */
  start(): Promise<AgentVoiceStartOutcome>;
  /** End the call. Local tasks and the backend session are left alone. */
  end(): Promise<void>;
  /** Suppress or resume microphone content without ending the call. */
  setMuted(muted: boolean): void;
}

/**
 * Where a transcript entry came from in the spoken stream. Kept with the
 * assembled text so a late fragment can still be matched to the group it
 * amends after a reload; the audio itself is never stored.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Transcript assembly".
 */
export interface VoiceSourceRange {
  /** Provider fragment id this text came from. */
  fragmentId: string;
  /** Start offset within the voice session, in milliseconds. */
  startMs: number;
  /** End offset within the voice session, in milliseconds. */
  endMs: number;
}

/**
 * How the voice layer stamps and mirrors typed submissions. Separate from
 * {@link AgentVoiceControls} because no UI calls these: the chat's task owner
 * does, at the moment a typed request is sent.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Typed input during voice".
 */
export interface AgentVoiceSubmissionMirror {
  /**
   * Stamp the presentation a live call requires, captured at submit time so a
   * later mode change never moves the answer.
   *
   * @param submission - The composer's immutable request.
   */
  prepareSubmission(submission: AgentTaskSubmission): AgentTaskSubmission;
  /**
   * Mirror an accepted typed request into the spoken conversation, so speech
   * never asks for work Copilot has already taken on.
   *
   * @param submission - The submission as prepared and sent.
   * @param acceptance - What the task owner decided.
   */
  noteSubmissionAccepted(submission: AgentTaskSubmission, acceptance: AgentTaskAcceptance): void;
}

/** Everything one conversation's chat binds when voice wiring is present. */
export interface AgentVoiceAttachment extends AgentVoiceControls, AgentVoiceSubmissionMirror {}

/**
 * An immutable request for backend work. The composer (or the voice layer)
 * resolves every attachment before constructing this; the task owner never
 * reaches back for more input.
 */
export interface AgentTaskSubmission {
  /** Caller-assigned identity. Resubmitting the same id returns the original task. */
  submissionId: string;
  /** The Copilot conversation this work belongs to. */
  conversationId: string;
  /**
   * Public conversation entries that already display this request. Empty means
   * the task owner must create the single public user entry itself.
   */
  sourceMessageIds: readonly string[];
  source: AgentTaskSource;
  presentation: AgentTaskPresentation;
  /** Text sent to the backend, after command expansion and token resolution. */
  requestText: string;
  /**
   * Verbatim composer text, retained for the up-arrow input history. Absent
   * for requests the user never typed.
   */
  rawInput?: string;
  context?: MessageContext;
  promptContent?: readonly PromptContent[];
  mentionedAgents?: readonly BackendId[];
  voiceSessionId?: string;
  /** Voice provider's own delegation identity. Never reconstructed from our ids. */
  delegationId?: string;
}

/**
 * A task's settled outcome. `completed` means the agent's response is ready —
 * not that every operation the user asked for succeeded.
 */
export interface AgentTaskResult {
  taskId: string;
  state: AgentTaskTerminalState;
  assistantMessageId: string;
  answerText: string;
  errorCode?: string;
}

/**
 * The conversation store's record of one unit of backend work. Links the
 * public entries that requested it to the assistant entry that answers it.
 */
export interface AgentTaskRecord {
  taskId: string;
  sourceMessageIds: readonly string[];
  /** Assistant entry the backend streams into. Absent until the turn starts. */
  assistantMessageId?: string;
  /** Every voice delegation this task answers; more than one after a merge. */
  delegationIds: readonly string[];
  state: AgentTaskState;
  presentation: AgentTaskPresentation;
}
