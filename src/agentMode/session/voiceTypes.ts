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
 * Live voice channel state. Mute and playback are independent flags rather
 * than states, because a muted microphone and silenced playback are both
 * legal in an otherwise `active` call.
 */
export interface VoiceRuntimeState {
  session: VoiceSessionState;
  /** Local microphone capture is suppressed. */
  inputMuted: boolean;
  /** Remote speech playback is suppressed. */
  playbackMuted: boolean;
}

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
