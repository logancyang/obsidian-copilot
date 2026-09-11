import { projectConversationRows } from "@/agentMode/session/AgentMessageStore";
import type { ContextDeliveryState } from "@/agentMode/session/ContextDeliveryCursor";
import { EMPTY_CONTEXT_DELIVERY } from "@/agentMode/session/ContextDeliveryCursor";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type {
  AgentMessageOrigin,
  AgentMessagePresentation,
  AgentTaskPresentation,
  AgentTaskRecord,
  AgentTaskState,
  VoiceSourceRange,
} from "@/agentMode/session/voiceTypes";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { logWarn } from "@/logger";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";

/**
 * Markdown storage for a conversation that mixes typed text, spoken text, and
 * task cards. The file stays an ordinary readable note: public text and task
 * summaries in the body, plus one encoded metadata comment that carries the
 * structure the readable projection cannot express.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
 */

/** Schema stamped in frontmatter and inside the snapshot itself. */
export const AGENT_CHAT_SCHEMA_VERSION = 2;

/**
 * What a reopened conversation got back.
 *
 *   - `none`: an ordinary chat with no structured voice history to restore.
 *   - `restored`: the snapshot validated and the mixed transcript is live.
 *   - `unavailable`: the file carries a snapshot that no longer matches its
 *     body (hand-edited note) or could not be parsed. Only the readable
 *     transcript is shown, and background saves must leave the file alone.
 *   - `unsupported-schema`: written by a newer Copilot. Read-only.
 */
export type AgentHistoryRestoreStatus = "none" | "restored" | "unavailable" | "unsupported-schema";

/**
 * A mixed conversation as it lives on disk: public transcript, the task
 * records linking requests to answers, and the backend's context-delivery
 * cursor. Raw audio, credentials, permission resolvers, and live tool trails
 * are deliberately absent.
 */
export interface AgentMixedConversation {
  conversationId: string;
  messages: readonly AgentChatMessage[];
  tasks: readonly AgentTaskRecord[];
  contextDelivery: ContextDeliveryState;
}

/** Outcome of reading a file's encoded metadata comment. */
export type AgentSnapshotReadResult =
  | { status: "restored"; conversation: AgentMixedConversation }
  | { status: "unavailable"; reason: "digest-mismatch" | "unreadable" }
  | { status: "unsupported-schema"; schema: number };

interface PersistedTimestamp {
  epoch: number;
  display: string;
}

interface PersistedMessage {
  id: string;
  sender: string;
  text: string;
  ts?: PersistedTimestamp;
  isError?: boolean;
  origin?: AgentMessageOrigin;
  voiceSessionId?: string;
  taskId?: string;
  presentation?: AgentMessagePresentation;
  sourceRanges?: VoiceSourceRange[];
}

interface PersistedTask {
  taskId: string;
  sourceMessageIds: string[];
  assistantMessageId?: string;
  delegationIds: string[];
  state: AgentTaskState;
  presentation: AgentTaskPresentation;
}

interface PersistedSnapshot {
  schema: number;
  conversationId: string;
  /** SHA-256 of the exact visible body this snapshot projects. */
  bodyDigest: string;
  messages: PersistedMessage[];
  tasks: PersistedTask[];
  contextDelivery: ContextDeliveryState;
}

const COMMENT_OPEN = "<!-- copilot-agent-chat:";
const COMMENT_CLOSE = " -->";
// Anchored at the very end of the body: user text may contain a look-alike
// comment, and only the trailing one is the writer's own.
const COMMENT_PATTERN = /\n*<!-- copilot-agent-chat:(\d+) ([A-Za-z0-9+/=]*) -->\s*$/;

const MESSAGE_ORIGINS: readonly string[] = ["typed", "voice-user", "voice-assistant", "backend"];
const MESSAGE_PRESENTATIONS: readonly string[] = ["conversation", "task-detail"];
const TASK_PRESENTATIONS: readonly string[] = ["text", "voice-card"];
const TASK_STATES: readonly string[] = [
  "queued",
  "running",
  "awaiting-user",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
];
/**
 * A task saved mid-flight cannot prove what the agent did before the process
 * went away, so it never reloads as a live or finished task.
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Persistence and reload".
 */
const UNSETTLED_TASK_STATES: readonly string[] = ["queued", "running", "awaiting-user"];

const TASK_STATE_LABELS: Record<AgentTaskState, string> = {
  queued: "queued",
  running: "running",
  "awaiting-user": "waiting for you",
  completed: "completed",
  cancelled: "cancelled",
  failed: "failed",
  interrupted: "interrupted",
};

const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

/**
 * Whether this conversation has to be written in the mixed-transcript schema.
 * Ordinary typed chats answer `false` and keep their original file format, so
 * the new schema never touches a conversation that has no voice content.
 *
 * @param messages - The full persistable transcript, including folded answers.
 * @param tasks - Task records linking requests to answers.
 */
export function conversationNeedsMixedSchema(
  messages: readonly AgentChatMessage[],
  tasks: readonly AgentTaskRecord[]
): boolean {
  if (tasks.some((task) => task.presentation === "voice-card")) return true;
  return messages.some(
    (message) =>
      message.origin === "voice-user" ||
      message.origin === "voice-assistant" ||
      message.voiceSessionId !== undefined
  );
}

/**
 * The human-readable half of a mixed conversation: public entries in the
 * long-standing `**sender**: text` form, with each voice task collapsed into a
 * summary that still spells out its full final answer. Someone reading the
 * note in Obsidian sees the whole conversation without the metadata comment.
 *
 * @param messages - The full persistable transcript, including folded answers.
 * @param tasks - Task records linking requests to answers.
 */
export function renderMixedChatBody(
  messages: readonly AgentChatMessage[],
  tasks: readonly AgentTaskRecord[]
): string {
  return projectConversationRows(messages, tasks)
    .map((row) => {
      if (row.kind === "message") return renderMessageBlock(row.message);
      // Every entry the backend wrote for the task, so the readable summary
      // carries the complete final answer rather than one streamed fragment.
      const answerMessages = messages.filter(
        (message) =>
          message.taskId === row.task.taskId && !row.task.sourceMessageIds.includes(message.id)
      );
      return renderTaskBlock(row.task, answerMessages);
    })
    .join("\n\n");
}

/**
 * The encoded metadata comment to append after `visibleBody`. Its payload is
 * base64 UTF-8, so no message content can terminate the comment, and it
 * carries a digest of the body it was generated from.
 *
 * @param conversation - Structure the readable body cannot express.
 * @param visibleBody - The exact body this snapshot projects.
 */
export function buildSnapshotComment(
  conversation: AgentMixedConversation,
  visibleBody: string
): string {
  const snapshot: PersistedSnapshot = {
    schema: AGENT_CHAT_SCHEMA_VERSION,
    conversationId: conversation.conversationId,
    bodyDigest: sha256(visibleBody),
    messages: conversation.messages.map(toPersistedMessage),
    tasks: conversation.tasks.map(toPersistedTask),
    contextDelivery: {
      delivered: [...conversation.contextDelivery.delivered],
      uncertain: [...conversation.contextDelivery.uncertain],
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const payload = arrayBufferToBase64(buffer);
  return `${COMMENT_OPEN}${AGENT_CHAT_SCHEMA_VERSION} ${payload}${COMMENT_CLOSE}`;
}

/**
 * Separate a saved body into the part a human reads and the trailing encoded
 * comment. Always call this before parsing a body: a stripped comment keeps
 * base64 out of the last message even when the snapshot is unusable.
 *
 * @param body - Note body with frontmatter already removed.
 */
export function splitSnapshotComment(body: string): {
  visibleBody: string;
  encoded: string | null;
  schema: number | null;
} {
  const match = body.match(COMMENT_PATTERN);
  if (!match) return { visibleBody: body.trim(), encoded: null, schema: null };
  return {
    visibleBody: body.slice(0, match.index).trim(),
    encoded: match[2],
    schema: Number.parseInt(match[1], 10),
  };
}

/**
 * Reconstruct a mixed conversation from its encoded comment. The snapshot is
 * trusted only when it parses, declares a schema this build understands, and
 * its digest matches the body beside it — a hand-edited note is reported as
 * unavailable rather than silently overriding what the user wrote.
 *
 * @param encoded - Base64 payload from the metadata comment.
 * @param visibleBody - The readable body the snapshot must match.
 */
export function readSnapshotComment(encoded: string, visibleBody: string): AgentSnapshotReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64ToArrayBuffer(encoded)));
  } catch (e) {
    logWarn("[AgentMode] agent chat snapshot could not be decoded", e);
    return { status: "unavailable", reason: "unreadable" };
  }
  if (typeof raw !== "object" || raw === null)
    return { status: "unavailable", reason: "unreadable" };
  const candidate = raw as Partial<PersistedSnapshot>;
  if (typeof candidate.schema !== "number" || !Number.isFinite(candidate.schema)) {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (candidate.schema > AGENT_CHAT_SCHEMA_VERSION) {
    return { status: "unsupported-schema", schema: candidate.schema };
  }
  if (candidate.schema < AGENT_CHAT_SCHEMA_VERSION) {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (typeof candidate.conversationId !== "string" || !candidate.conversationId.trim()) {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (typeof candidate.bodyDigest !== "string" || !Array.isArray(candidate.messages)) {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (candidate.bodyDigest !== sha256(visibleBody)) {
    return { status: "unavailable", reason: "digest-mismatch" };
  }
  const messages: AgentChatMessage[] = [];
  for (const entry of candidate.messages) {
    const message = fromPersistedMessage(entry);
    if (!message) return { status: "unavailable", reason: "unreadable" };
    messages.push(message);
  }
  const tasks: AgentTaskRecord[] = [];
  for (const entry of Array.isArray(candidate.tasks) ? candidate.tasks : []) {
    const task = fromPersistedTask(entry);
    if (!task) return { status: "unavailable", reason: "unreadable" };
    tasks.push(task);
  }
  return {
    status: "restored",
    conversation: {
      conversationId: candidate.conversationId,
      messages,
      tasks,
      contextDelivery: readContextDelivery(candidate.contextDelivery),
    },
  };
}

function renderMessageBlock(message: AgentChatMessage): string {
  const ts = message.timestamp ? message.timestamp.display : "Unknown time";
  return `**${message.sender}**: ${message.message}\n[Timestamp: ${ts}]`;
}

function renderTaskBlock(
  task: AgentTaskRecord,
  answerMessages: readonly AgentChatMessage[]
): string {
  const body = answerMessages
    .map((message) => message.message.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
  const ts = answerMessages[0]?.timestamp?.display;
  const heading = `_Voice task — ${TASK_STATE_LABELS[task.state]}_`;
  const text = body || "_No answer was recorded for this task._";
  return `**${AI_SENDER}**: ${heading}\n\n${text}\n[Timestamp: ${ts ?? "Unknown time"}]`;
}

function toPersistedMessage(message: AgentChatMessage): PersistedMessage {
  return {
    id: message.id,
    sender: message.sender,
    text: message.message,
    ...(message.timestamp
      ? { ts: { epoch: message.timestamp.epoch, display: message.timestamp.display } }
      : {}),
    ...(message.isErrorMessage ? { isError: true } : {}),
    ...(message.origin !== undefined ? { origin: message.origin } : {}),
    ...(message.voiceSessionId !== undefined ? { voiceSessionId: message.voiceSessionId } : {}),
    ...(message.taskId !== undefined ? { taskId: message.taskId } : {}),
    ...(message.presentation !== undefined ? { presentation: message.presentation } : {}),
    ...(message.sourceRanges && message.sourceRanges.length > 0
      ? { sourceRanges: message.sourceRanges.map((range) => ({ ...range })) }
      : {}),
  };
}

function fromPersistedMessage(raw: unknown): AgentChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Partial<PersistedMessage>;
  if (typeof entry.id !== "string" || !entry.id) return null;
  if (entry.sender !== USER_SENDER && entry.sender !== AI_SENDER) return null;
  if (typeof entry.text !== "string") return null;
  const ts = entry.ts;
  return {
    id: entry.id,
    sender: entry.sender,
    message: entry.text,
    // `fileName` is only used when naming a new note, so a restored entry
    // carries the empty value the legacy parser also produces.
    timestamp:
      ts && typeof ts.epoch === "number" && typeof ts.display === "string"
        ? { epoch: ts.epoch, display: ts.display, fileName: "" }
        : null,
    isVisible: true,
    ...(entry.isError ? { isErrorMessage: true } : {}),
    ...(typeof entry.origin === "string" && MESSAGE_ORIGINS.includes(entry.origin)
      ? { origin: entry.origin }
      : {}),
    ...(typeof entry.voiceSessionId === "string" ? { voiceSessionId: entry.voiceSessionId } : {}),
    ...(typeof entry.taskId === "string" ? { taskId: entry.taskId } : {}),
    ...(typeof entry.presentation === "string" && MESSAGE_PRESENTATIONS.includes(entry.presentation)
      ? { presentation: entry.presentation }
      : {}),
    ...(Array.isArray(entry.sourceRanges)
      ? { sourceRanges: entry.sourceRanges.filter(isSourceRange) }
      : {}),
  };
}

function isSourceRange(raw: unknown): raw is VoiceSourceRange {
  if (typeof raw !== "object" || raw === null) return false;
  const range = raw as Partial<VoiceSourceRange>;
  return (
    typeof range.fragmentId === "string" &&
    typeof range.startMs === "number" &&
    typeof range.endMs === "number"
  );
}

function toPersistedTask(task: AgentTaskRecord): PersistedTask {
  return {
    taskId: task.taskId,
    sourceMessageIds: [...task.sourceMessageIds],
    ...(task.assistantMessageId !== undefined
      ? { assistantMessageId: task.assistantMessageId }
      : {}),
    delegationIds: [...task.delegationIds],
    state: task.state,
    presentation: task.presentation,
  };
}

function fromPersistedTask(raw: unknown): AgentTaskRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Partial<PersistedTask>;
  if (typeof entry.taskId !== "string" || !entry.taskId) return null;
  if (typeof entry.state !== "string" || !TASK_STATES.includes(entry.state)) return null;
  if (typeof entry.presentation !== "string" || !TASK_PRESENTATIONS.includes(entry.presentation)) {
    return null;
  }
  const sourceMessageIds = readStringArray(entry.sourceMessageIds);
  return {
    taskId: entry.taskId,
    sourceMessageIds,
    ...(typeof entry.assistantMessageId === "string"
      ? { assistantMessageId: entry.assistantMessageId }
      : {}),
    delegationIds: readStringArray(entry.delegationIds),
    state: UNSETTLED_TASK_STATES.includes(entry.state) ? "interrupted" : entry.state,
    presentation: entry.presentation,
  };
}

function readStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return EMPTY_STRINGS;
  const values = raw.filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values : EMPTY_STRINGS;
}

function readContextDelivery(raw: unknown): ContextDeliveryState {
  if (typeof raw !== "object" || raw === null) return EMPTY_CONTEXT_DELIVERY;
  const entry = raw as Partial<ContextDeliveryState>;
  const delivered = readStringArray(entry.delivered);
  const uncertain = readStringArray(entry.uncertain);
  if (delivered.length === 0 && uncertain.length === 0) return EMPTY_CONTEXT_DELIVERY;
  return { delivered, uncertain };
}
