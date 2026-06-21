import type {
  AgentChatMessage,
  AgentToolKind,
  BackendId,
  PromptContent,
} from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

/**
 * Read-only QA preamble prepended to every fan-out agent's prompt. Per-backend
 * permission denial and sandbox mode are belt-and-suspenders on top of it.
 */
export const FANOUT_READONLY_PREAMBLE =
  "You are answering a read-only question. Do NOT modify any files, run any " +
  "commands that change state, or execute write/shell tools — answer only. " +
  "You may freely read, search, grep, and fetch to inform your answer. " +
  "Respond with your analysis directly.";

/**
 * Per-turn fan-out state. Held LIVE on the owning assistant message
 * (`AgentChatMessage.fanout`) and PERSISTED to the message body as a composite
 * ({@link serializeFanoutComposite}) so the dropdown reconstructs on reload
 * ({@link parseFanoutComposite}).
 */
export interface FanoutTurn {
  /**
   * One slot per ANSWERER (the deduped `@`-mentioned installed agents), keyed by
   * `BackendId`. The session main agent is the separate summarizer and has a
   * slot only if it was itself `@`-mentioned.
   */
  answers: Record<BackendId, AgentAnswer>;
  /** Narrative summary, filled by the main agent. The only part that persists. */
  summary: FanoutSummary;
}

/**
 * Live status of one agent's answer. `cancelled` is distinct from `error`: the
 * user aborted the turn, not an agent fault. Both are terminal; neither feeds
 * the summary.
 */
export type AgentAnswerStatus = "running" | "done" | "error" | "cancelled";

/** One agent's slot in a fan-out turn. `error` is set when `status === "error"`. */
export interface AgentAnswer {
  backendId: BackendId;
  status: AgentAnswerStatus;
  text: string;
  error?: string;
}

/**
 * Per-agent answer timeout. Each agent's `prompt()` races this deadline; on
 * expiry the orchestrator cancels that sub-session and marks the slot `error`
 * with {@link FANOUT_AGENT_TIMEOUT_ERROR}, so one hung sub-session fails its own
 * slot without stalling the others.
 */
export const FANOUT_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

/** Human-readable reason set on a slot that exceeded {@link FANOUT_AGENT_TIMEOUT_MS}. */
export const FANOUT_AGENT_TIMEOUT_ERROR = "Timed out waiting for this agent to answer.";

/**
 * Grace window the orchestrator waits, after requesting `cancel`, for a
 * cancelled/timed-out sub-session's `prompt()` to settle before that backend is
 * reused (the summary reuses the main agent's backend). The Claude SDK backend's
 * permission-bridge/session context is process-global for the active query, so a
 * second prompt mid-unwind can misroute permission decisions or corrupt the
 * summary. Bounded so a backend that ignores cancel can't hang the turn forever
 * — if the grace elapses we proceed anyway (logged).
 */
export const FANOUT_CANCEL_GRACE_MS = 3 * 1000;

/**
 * Tail grace the orchestrator holds an ephemeral sub-session's update handler
 * open after `prompt()` resolves normally, before tearing it down. Some ACP
 * backends (opencode, fast models) flush a turn's FINAL `agent_message_chunk`
 * events just after the `session/prompt` result resolves; without this window
 * those trailing chunks arrive once the handler is gone and are dropped,
 * truncating an answer at the end. Only applied on the normal resolve path —
 * cancel/timeout intentionally suppress late output and skip this wait.
 */
export const FANOUT_TRAILING_CHUNK_GRACE_MS = 500;

/** Status of the main-agent narrative summary slot. */
export type FanoutSummaryStatus = "pending" | "streaming" | "done";

/** The summary slot — the only part of a fan-out turn that is persisted. */
export interface FanoutSummary {
  status: FanoutSummaryStatus;
  text: string;
  /**
   * True once the summary finished SUCCESSFULLY (not cancel/error/timeout).
   * `status` alone can't say — it is forced to `done` on every exit so the UI
   * never sticks on a spinner. Live-only; never serialized.
   */
  complete?: boolean;
}

/**
 * Tool kinds that mutate the vault or execute commands, hard-denied in a
 * read-only fan-out sub-session. `other` is intentionally NOT here: denying it
 * would block legitimate read-only MCP tools, and the prompt + sandbox already
 * steer the agent away from mutations.
 */
const WRITE_OR_EXEC_KINDS: ReadonlySet<AgentToolKind> = new Set<AgentToolKind>([
  "edit",
  "delete",
  "move",
  "execute",
]);

/**
 * Whether a tool kind must be denied in a read-only fan-out sub-session.
 * `undefined` (kind not reported) is treated as a write to fail safe.
 */
export function isWriteOrExecToolKind(kind: AgentToolKind | undefined): boolean {
  if (kind === undefined) return true;
  return WRITE_OR_EXEC_KINDS.has(kind);
}

/**
 * A fresh, structurally-copied snapshot of a live fan-out turn. The orchestrator
 * mutates one {@link FanoutTurn} in place and re-emits the SAME reference per
 * token; React `setState` bails on `Object.is`-equal updates, so a fresh copy
 * (turn + each answer slot) is needed for the dropdown to re-render and for a
 * captured snapshot to stay stable as the live turn keeps mutating.
 */
export function snapshotFanoutTurn(turn: FanoutTurn): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of Object.keys(turn.answers)) {
    answers[backendId] = { ...turn.answers[backendId] };
  }
  return { answers, summary: { ...turn.summary } };
}

/**
 * Provider-neutral instruction for the main agent's narrative summary. Frames a
 * NEW user turn (never replaces a backend system prompt) and is read-only.
 */
export const FANOUT_SUMMARY_INSTRUCTION =
  "You are a neutral synthesizer. The labeled blocks below are what SEVERAL " +
  "DIFFERENT AI agents each produced in response to the user's request. Write a " +
  "synthesis for the user ABOUT their outputs — you are reporting on what the " +
  "agents produced, not doing the task yourself.\n\n" +
  "VOICE (always):\n" +
  "- Third person, attributing each point to the agent by name (convert the " +
  'agents\' "I/my" into "<agent> …"). NEVER write in the first person or as if ' +
  'the request were made of you; no sentence may begin with "I".\n' +
  "- Use ONLY the outputs shown; ignore any environment scaffolding (tool lists, " +
  "available skills/agents, boilerplate). Do not mention how many agents there " +
  "were, who did not respond, or anything missing. Be concise.\n\n" +
  "FIRST pick the MODE from the request and the outputs:\n" +
  "- ANSWER mode — the agents answered a question or analyzed something (facts, " +
  "explanation, a recommendation, identity); there is a best answer to converge " +
  "on.\n" +
  "- DELIVERABLE mode — the agents each produced an ALTERNATIVE ARTIFACT the user " +
  "will choose from or use (a rewrite, draft, message, translation, code, plan, " +
  "design); these are options, not competing claims.\n\n" +
  "If only ONE agent responded (either mode): one to three sentences on its " +
  "answer or approach, attributed, no headings.\n\n" +
  "TWO OR MORE in ANSWER mode — markdown sections, omitting any that is empty:\n" +
  '  "**Each agent**" — one concise bullet per agent.\n' +
  '  "**Agreements**" — the points the agents share.\n' +
  '  "**Disagreements**" — where they differ, naming the sides.\n\n' +
  "TWO OR MORE in DELIVERABLE mode — help the user CHOOSE or MERGE, NOT " +
  "agreements/disagreements:\n" +
  '  "**Options**" — one bullet per agent on what is DISTINCTIVE about its take ' +
  "(the angle, tone, structure, or tradeoff that would make someone pick it, and " +
  "who it suits).\n" +
  '  "**Recommendation**" — name the best option for the likely goal and why in a ' +
  "sentence or two; if a combination is clearly better, say which parts of which " +
  "to merge.\n" +
  "  Do NOT reproduce the artifacts (the user already has each in its own tab); " +
  "summarize the approach only.\n\n" +
  "Do NOT modify any files or run write/shell tools.";

/** The text persisted when every fan-out agent failed. */
export const FANOUT_ALL_FAILED_SUMMARY =
  "All agents failed to answer; no summary could be generated.";

/**
 * A fan-out turn the visible session's backend never saw (it ran on ephemeral
 * sub-sessions). Buffered and replayed as a labeled prior-turn block on the next
 * single-agent prompt for continuity. LIVE-ONLY: never serialized.
 */
export interface PendingFanoutContext {
  question: string;
  summary: string;
}

/** Frozen empty buffer — the referentially-stable "nothing pending" value. */
export const EMPTY_PENDING_FANOUT_CONTEXT: ReadonlyArray<PendingFanoutContext> = Object.freeze([]);

/**
 * Compose the buffered fan-out turns into a labeled prior-turn block for the next
 * single-agent prompt so the backend reads them as earlier conversation, not a
 * fresh task. Returns `null` for an empty buffer (prompt unchanged).
 */
export function buildPriorFanoutContextBlock(
  entries: ReadonlyArray<PendingFanoutContext>
): string | null {
  if (entries.length === 0) return null;
  // Escape the user-controlled question/summary so a stray `</summary>` can't
  // break the framing — same convention as the sibling `<web_*>` builders.
  const turns = entries
    .map(
      (e) =>
        `<multi_agent_turn>\n<question>\n${escapeXml(e.question)}\n</question>\n` +
        `<summary>\n${escapeXml(e.summary)}\n</summary>\n</multi_agent_turn>`
    )
    .join("\n");
  return (
    "<prior_turns>\n" +
    "Earlier in this conversation you ran the following multi-agent turn(s). " +
    "Each shows the user's question and the summary that was already shown to " +
    "the user. Treat these as conversation history for continuity; do not " +
    "redo or re-answer them.\n" +
    `${turns}\n` +
    "</prior_turns>"
  );
}

/**
 * Char cap on the rendered `<conversation_history>` block injected into every
 * fan-out agent's prompt. Each fan-out agent runs in a FRESH single-turn
 * ephemeral sub-session, so the entire prior transcript rides in ONE prompt;
 * unlike a long-running session, nothing here gets compacted, so an oversized
 * block would hard-error the model API ("prompt too long") rather than
 * auto-truncate (D3). 48k chars (~12k tokens) covers typical chats with room to
 * spare against a ~200k-token window even multiplied across agents; oldest-first
 * truncation only kicks in on pathologically long conversations.
 */
export const FANOUT_HISTORY_MAX_CHARS = 48_000;

/** Marker prepended when the oldest turns are dropped to fit the cap. */
const FANOUT_HISTORY_TRUNCATION_MARKER = "[earlier conversation truncated]";

/** Inline marker appended when a single retained turn is itself truncated to fit the cap. */
const FANOUT_HISTORY_TURN_TRUNCATION_MARKER = "[turn truncated]";

/** Per-item char budget so one large excerpt can't dominate the history. */
const FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;

/** Trim `s` to its leading `max` chars, appending `marker` only when it actually overflows. */
function trimHead(s: string, max: number, marker: string): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n${marker}`;
}

/**
 * Count the image attachment blocks in a user message's `content` array. The
 * field is typed `unknown[]`, so each entry is narrowed defensively to a non-null
 * object whose `type` is `"image"` (prompt-block shape) or `"image_url"` (the
 * live `buildUserDisplayContent` projection); other entries are ignored.
 */
function countImageAttachments(content: readonly unknown[] | undefined): number {
  if (!content) return 0;
  let count = 0;
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) continue;
    const type = (entry as { type?: unknown }).type;
    if (type === "image" || type === "image_url") count += 1;
  }
  return count;
}

/**
 * Render a turn's attached {@link MessageContext} (pinned notes, selected
 * excerpts, folders, urls, tags, web tabs) into one `[context]` section so a
 * fan-out agent — a FRESH session with no memory — can resolve a follow-up like
 * "explain the selected excerpt above". Selection excerpts carry their actual
 * text (trimmed per item); every other field collapses to an identifier line.
 * Note paths and tab urls (not basenames/titles) are emitted so a fresh
 * session's Read/fetch can resolve them. Values are NOT escaped here:
 * `buildConversationHistoryBlock` escapes the whole turn body once. An empty
 * context renders nothing, leaving the turn byte-for-byte unchanged.
 */
function renderMessageContext(context: MessageContext | undefined): string[] {
  if (!context) return [];
  const lines: string[] = [];

  for (const sel of context.selectedTextContexts ?? []) {
    const label = isNoteSelectedTextContext(sel)
      ? sel.noteTitle
      : isWebSelectedTextContext(sel)
        ? sel.title || sel.url
        : "selection";
    const excerpt = trimHead(
      sel.content.trim(),
      FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS,
      FANOUT_HISTORY_TURN_TRUNCATION_MARKER
    );
    lines.push(`[selected from ${label}]\n${excerpt}`);
  }

  const noteNames = (context.notes ?? []).map((n) => n.path);
  if (noteNames.length > 0) lines.push(`[notes: ${noteNames.join(", ")}]`);

  if (context.folders && context.folders.length > 0) {
    lines.push(`[folders: ${context.folders.join(", ")}]`);
  }
  if (context.urls && context.urls.length > 0) {
    lines.push(`[urls: ${context.urls.join(", ")}]`);
  }
  if (context.tags && context.tags.length > 0) {
    lines.push(`[tags: ${context.tags.join(", ")}]`);
  }
  if (context.webTabs && context.webTabs.length > 0) {
    const tabs = context.webTabs.map((t) => (t.title ? `${t.title} (${t.url})` : t.url)).join(", ");
    lines.push(`[web tabs: ${tabs}]`);
  }

  if (lines.length === 0) return [];
  return [`[context]\n${lines.join("\n")}`];
}

/**
 * History-safe prose for an assistant turn. A fan-out turn's `message` body is
 * the PERSISTED composite (HTML-comment markers + marker-escaped content), so
 * feeding it raw would leak hidden metadata; render the clean composite from the
 * live/parsed `fanout` turn instead. A non-fan-out message returns unchanged.
 */
function historyProse(message: AgentChatMessage): string {
  const turn = message.fanout ?? parseFanoutComposite(message.message);
  return turn ? renderFanoutComposite(turn, (id) => id) : message.message;
}

/**
 * One transcript turn's renderable body: prose, an image-attachment marker, then
 * its attached {@link MessageContext}. `null` when all are absent.
 */
function renderTurnContent(message: AgentChatMessage): string | null {
  const segments: string[] = [];
  const prose = historyProse(message).trim();
  if (prose.length > 0) segments.push(prose);
  // Note that images existed even though their bytes aren't in fan-out history,
  // so the context loss isn't silent.
  const imageCount = countImageAttachments(message.content);
  if (imageCount > 0) {
    const noun = imageCount === 1 ? "image attachment" : "image attachments";
    segments.push(`[${imageCount} ${noun} omitted from history; existed in this turn]`);
  }
  segments.push(...renderMessageContext(message.context));
  if (segments.length === 0) return null;
  return segments.join("\n");
}

/**
 * Render the prior visible transcript into a single read-only
 * `<conversation_history>` block for fan-out agent prompts. Each fan-out agent
 * opens a FRESH session with no memory, so this is how it sees what came before,
 * framed as context to USE, not a task to redo.
 *
 * `messages` must be PRIOR turns only (caller excludes the in-flight pair). Each
 * turn is labeled by role and XML-escaped so its text can't break the framing.
 * The body is bounded by `maxChars`: oldest turns drop first, and a single
 * retained turn that still overflows is itself truncated. Returns `null` for no
 * prior history so the caller leaves the prompt byte-for-byte unchanged.
 */
export function buildConversationHistoryBlock(
  messages: readonly AgentChatMessage[],
  maxChars: number
): string | null {
  const rendered: string[] = [];
  for (const m of messages) {
    const content = renderTurnContent(m);
    if (content === null) continue;
    const role = m.sender === USER_SENDER ? "user" : "assistant";
    rendered.push(`<turn role="${role}">\n${escapeXml(content)}\n</turn>`);
  }
  if (rendered.length === 0) return null;

  // Drop oldest-first until the joined turns fit the cap, tracking a running
  // char total (each turn's length plus the "\n" separator that joins it to the
  // next) so we never re-join the whole transcript per drop. Only the most
  // recent turns survive a pathologically long chat.
  let total = rendered.reduce((n, t) => n + t.length + 1, -1);
  let truncated = false;
  while (rendered.length > 1 && total > maxChars) {
    total -= rendered.shift()!.length + 1;
    truncated = true;
  }

  // Final hard cap: a single surviving turn (a long answer or pasted dump) can
  // alone exceed `maxChars`; the drop loop can't shrink it, so truncate the
  // joined body's head and mark it. Guarantees the body is bounded by ~maxChars
  // regardless of input — the prompt-too-large error the cap exists to prevent.
  let body = rendered.join("\n");
  if (body.length > maxChars) {
    body = trimHead(body, maxChars, FANOUT_HISTORY_TURN_TRUNCATION_MARKER);
    truncated = true;
  }

  const header =
    "Earlier in this conversation the following was said. Treat this as " +
    "read-only context to inform your answer; do NOT redo or re-answer these " +
    "earlier turns. Answer only the current question that follows.";
  if (truncated) body = `${FANOUT_HISTORY_TRUNCATION_MARKER}\n${body}`;
  return `<conversation_history>\n${header}\n${body}\n</conversation_history>`;
}

/** One agent's succeeded answer, ready to feed into the summary prompt. */
export interface SucceededAnswer {
  backendId: BackendId;
  text: string;
}

/**
 * The agents whose answers feed the summary, partitioned: `succeeded` are `done`
 * slots with non-empty text; `failed` are slots that errored or finished empty.
 * Insertion order is preserved on both, matching the answer-slot order.
 */
export interface SummaryInputs {
  succeeded: SucceededAnswer[];
  failed: BackendId[];
}

/**
 * Partition a settled turn's answers into {@link SummaryInputs}. A `done` slot
 * with only whitespace is treated as a failure — it carries nothing to reconcile.
 */
export function selectSummaryInputs(turn: FanoutTurn): SummaryInputs {
  const succeeded: SucceededAnswer[] = [];
  const failed: BackendId[] = [];
  for (const backendId of Object.keys(turn.answers)) {
    const slot = turn.answers[backendId];
    const text = slot.text.trim();
    if (slot.status === "done" && text.length > 0) {
      succeeded.push({ backendId, text });
    } else {
      failed.push(backendId);
    }
  }
  return { succeeded, failed };
}

/**
 * Per-answer char cap on answers fed into the SUMMARY prompt (bounds MODEL
 * INPUT, not the on-disk transcript). Several answers stack into one summary
 * prompt, so this is tighter than the persisted cap to avoid blowing the context
 * window (worst case ≈ agent count × this).
 */
const FANOUT_SUMMARY_ANSWER_MAX_CHARS = 12_000;
const FANOUT_SUMMARY_ANSWER_TRUNCATION_MARKER = "[answer truncated]";

/**
 * Compose the NEW user-turn prompt fed to the main agent for the summary: the
 * instruction, the user's original prompt, then each succeeded answer labeled by
 * its agent's display name. `displayNameFor` falls back to the id when unknown.
 * Returns `null` when zero agents succeeded so the caller doesn't fabricate a
 * summary over nothing.
 */
export function buildSummaryUserPrompt(
  originalPrompt: string,
  inputs: SummaryInputs,
  displayNameFor: (backendId: BackendId) => string
): PromptContent[] | null {
  if (inputs.succeeded.length === 0) return null;
  // Cap each answer's length so a single oversized one can't blow the summary
  // sub-session's context/timeout.
  const sections = inputs.succeeded.map(
    ({ backendId, text }) =>
      `### ${displayNameFor(backendId)}\n${trimHead(text, FANOUT_SUMMARY_ANSWER_MAX_CHARS, FANOUT_SUMMARY_ANSWER_TRUNCATION_MARKER)}`
  );
  // Only SUCCEEDED answers are shown; failed agents are omitted entirely so the
  // summary can't mention or speculate about them.
  const parts = [
    FANOUT_SUMMARY_INSTRUCTION,
    `## Question\n${originalPrompt.trim()}`,
    `## Agent answers\n${sections.join("\n\n")}`,
  ];
  return [{ type: "text", text: parts.join("\n\n") }];
}

/**
 * Char cap on EACH persisted agent answer in the composite body (bounds the
 * on-disk transcript, not the model input). Large enough that a normal QA answer
 * is never clipped; the summary is persisted uncapped.
 */
export const FANOUT_PERSISTED_ANSWER_MAX_CHARS = 24_000;

const FANOUT_PERSISTED_ANSWER_TRUNCATION_MARKER = "[answer truncated]";

/** Composite format version, embedded in the opening marker for forward-compat. */
const FANOUT_COMPOSITE_VERSION = 1;

/** Opening marker that flags an assistant body as a serialized fan-out composite. */
const FANOUT_MARKER_OPEN = `<!--copilot:multi-agent v=${FANOUT_COMPOSITE_VERSION}-->`;

/**
 * Version-agnostic open marker matcher. {@link parseFanoutComposite} requires
 * both this and the close marker before treating a body as a composite, so an
 * answer merely mentioning the format is never misread as a serialized turn.
 */
const FANOUT_MARKER_OPEN_RE = /<!--copilot:multi-agent v=\d+-->/;

/** Closing marker of a serialized fan-out composite. */
const FANOUT_MARKER_CLOSE = "<!--copilot:multi-agent-end-->";

/** Section marker introducing the summary block. */
const FANOUT_MARKER_SUMMARY = "<!--copilot:summary-->";

/**
 * Marker-escape sentinel: a Private-Use-Area codepoint that won't occur in
 * normal prose. An answer may legitimately contain the literal marker prefix
 * (e.g. quoting this format); writing it verbatim would forge a section marker.
 * We neutralize the colon after `copilot` on write and restore it on read.
 *
 * Lossless even when the answer already contains the sentinel: literal sentinels
 * are escaped FIRST (`S`+`0`), then marker colons (`S`+`1`), so the two never
 * collide and the read side reverses both unambiguously. The sentinel-doubling
 * step is required \u2014 without it, raw escaped byte sequences corrupt on read.
 */
const FANOUT_MARKER_SENTINEL = "\uE000";
const FANOUT_SENTINEL_LITERAL_ESCAPE = `${FANOUT_MARKER_SENTINEL}0`;
const FANOUT_SENTINEL_COLON_ESCAPE = `${FANOUT_MARKER_SENTINEL}1`;
const FANOUT_LITERAL_MARKER_PREFIX = "<!--copilot:";
const FANOUT_ESCAPED_MARKER_PREFIX = `<!--copilot${FANOUT_SENTINEL_COLON_ESCAPE}`;

/**
 * Escape body text so it can never forge a section marker. Order matters: double
 * any literal sentinel FIRST so the colon escapes are the only single-sentinel
 * sequences.
 */
function escapeFanoutMarkers(text: string): string {
  return text
    .split(FANOUT_MARKER_SENTINEL)
    .join(FANOUT_SENTINEL_LITERAL_ESCAPE)
    .split(FANOUT_LITERAL_MARKER_PREFIX)
    .join(FANOUT_ESCAPED_MARKER_PREFIX);
}

/** Inverse of {@link escapeFanoutMarkers}: restore colon escapes, then collapse doubled sentinels. */
function unescapeFanoutMarkers(text: string): string {
  return text
    .split(FANOUT_ESCAPED_MARKER_PREFIX)
    .join(FANOUT_LITERAL_MARKER_PREFIX)
    .split(FANOUT_SENTINEL_LITERAL_ESCAPE)
    .join(FANOUT_MARKER_SENTINEL);
}

/** Trim a persisted agent answer to the cap, marking it only when it overflows. */
function capPersistedAnswer(text: string): string {
  if (text.length <= FANOUT_PERSISTED_ANSWER_MAX_CHARS) return text;
  return `${text.slice(0, FANOUT_PERSISTED_ANSWER_MAX_CHARS)}\n${FANOUT_PERSISTED_ANSWER_TRUNCATION_MARKER}`;
}

/** Note emitted (in the `note` attribute) for an agent that produced no answer. */
const FANOUT_NO_ANSWER_NOTE = "did not answer";

/**
 * Serialize a completed fan-out turn into the PERSISTED assistant message body:
 * the summary plus each agent's answer, delimited by HTML-comment section markers
 * the reload parse keys on ({@link parseFanoutComposite}); the `### Heading`
 * lines are cosmetic. A failed/cancelled agent persists its partial text when it
 * streamed any, else a body-less marker carrying `status` + `note`. Each answer
 * is capped and marker-escaped so it can't forge a section.
 */
export function serializeFanoutComposite(
  turn: FanoutTurn,
  displayName: (backendId: BackendId) => string
): string {
  const { succeeded } = selectSummaryInputs(turn);
  const succeededIds = new Set(succeeded.map((s) => s.backendId));
  const summaryText = turn.summary.text.trim();

  const lines: string[] = [FANOUT_MARKER_OPEN, FANOUT_MARKER_SUMMARY, "### Summary"];
  if (summaryText.length > 0) lines.push(escapeFanoutMarkers(summaryText));

  for (const backendId of Object.keys(turn.answers)) {
    const name = displayName(backendId);
    const nameAttr = ` name="${escapeMarkerAttr(name)}"`;
    const slot = turn.answers[backendId];
    if (succeededIds.has(backendId)) {
      lines.push(
        `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr} status="done"-->`,
        `### ${name}`,
        escapeFanoutMarkers(capPersistedAnswer(slot.text.trim()))
      );
    } else {
      // A failed/cancelled agent: persist its partial text (with terminal status)
      // so a reload matches the live tab, else a body-less "did not answer" marker.
      const errorAttr =
        slot.status === "error" && slot.error ? ` error="${escapeMarkerAttr(slot.error)}"` : "";
      const statusAttr = ` status="${escapeMarkerAttr(slot.status)}"`;
      const partial = slot.text.trim();
      if (partial.length > 0) {
        lines.push(
          `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr}${statusAttr}${errorAttr}-->`,
          `### ${name}`,
          escapeFanoutMarkers(capPersistedAnswer(partial))
        );
      } else {
        lines.push(
          `<!--copilot:agent id="${escapeMarkerAttr(backendId)}"${nameAttr}${statusAttr}${errorAttr} note="${FANOUT_NO_ANSWER_NOTE}"-->`
        );
      }
    }
  }

  lines.push(FANOUT_MARKER_CLOSE);
  return lines.join("\n");
}

/**
 * The CLEAN composite (markers stripped) for copy / insert of the whole turn:
 * readable markdown so the user copies prose, never the invisible markers.
 */
export function renderFanoutComposite(
  turn: FanoutTurn,
  displayName: (backendId: BackendId) => string
): string {
  const { succeeded } = selectSummaryInputs(turn);
  const succeededIds = new Set(succeeded.map((s) => s.backendId));
  const sections: string[] = [];

  const summaryText = turn.summary.text.trim();
  sections.push(summaryText.length > 0 ? `### Summary\n${summaryText}` : "### Summary");

  for (const backendId of Object.keys(turn.answers)) {
    const name = displayName(backendId);
    const slot = turn.answers[backendId];
    if (succeededIds.has(backendId)) {
      sections.push(`### ${name}\n${slot.text.trim()}`);
    } else {
      // A terminal slot keeps partial text if any; an empty one gets the note.
      const partial = slot.text.trim();
      sections.push(
        partial.length > 0 ? `### ${name}\n${partial}` : `### ${name}\n_${FANOUT_NO_ANSWER_NOTE}_`
      );
    }
  }

  return sections.join("\n\n");
}

/**
 * Escape a marker attribute value so it can't break the comment or parser: `--`
 * confuses the HTML comment, `"` ends the attribute, `>` terminates the marker
 * early. Backend-controlled text flows through here, so all three are neutralized.
 */
function escapeMarkerAttr(value: string): string {
  return value.replace(/--/g, "—").replace(/"/g, "'").replace(/>/g, "›");
}

/** Read a `key="value"` attribute out of a marker's inner text. */
function readMarkerAttr(marker: string, key: string): string | undefined {
  const match = marker.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1] : undefined;
}

/** Map a serialized status string back to a terminal {@link AgentAnswerStatus}. */
function statusFromMarker(raw: string | undefined): AgentAnswerStatus {
  if (raw === "done" || raw === "error" || raw === "cancelled") return raw;
  // Any unknown/non-terminal value reads as a failed answer.
  return "error";
}

/**
 * Inverse of {@link serializeFanoutComposite}. Returns `null` for a plain/old
 * message (no composite marker). Reconstructs a {@link FanoutTurn} keying ONLY on
 * the section markers (the cosmetic `### Heading` lines are ignored); inner text
 * is marker-unescaped so a literal `<!--copilot:` is restored verbatim.
 */
export function parseFanoutComposite(body: string): FanoutTurn | null {
  // Require the COMPLETE wrapper (open + close), so a plain answer that merely
  // contains `<!--copilot:…` is left as-is, not hidden behind the fan-out card.
  if (!FANOUT_MARKER_OPEN_RE.test(body) || !body.includes(FANOUT_MARKER_CLOSE)) return null;

  const answers: Record<BackendId, AgentAnswer> = {};
  let summaryText = "";

  // Split on every section marker, tagging each chunk with its opening marker;
  // chunks before the open / after the end marker are framing chrome.
  const markerRe = /<!--copilot:(summary|agent[^>]*|multi-agent(?:-end)?[^>]*)-->/g;
  type Section = { marker: string; body: string };
  const sections: Section[] = [];
  let match: RegExpExecArray | null;
  let lastMarker: string | null = null;
  let lastIndex = 0;
  while ((match = markerRe.exec(body)) !== null) {
    if (lastMarker !== null) {
      sections.push({ marker: lastMarker, body: body.slice(lastIndex, match.index) });
    }
    lastMarker = match[0];
    lastIndex = markerRe.lastIndex;
  }
  if (lastMarker !== null) sections.push({ marker: lastMarker, body: body.slice(lastIndex) });

  for (const section of sections) {
    if (section.marker.startsWith("<!--copilot:multi-agent")) continue; // open/end chrome
    const inner = stripLeadingHeading(unescapeFanoutMarkers(section.body)).trim();
    if (section.marker === FANOUT_MARKER_SUMMARY) {
      summaryText = inner;
      continue;
    }
    // Agent section.
    const id = readMarkerAttr(section.marker, "id");
    if (!id) continue;
    const status = statusFromMarker(readMarkerAttr(section.marker, "status"));
    const note = readMarkerAttr(section.marker, "note");
    const errorReason = readMarkerAttr(section.marker, "error");
    answers[id] = {
      backendId: id,
      status,
      // A body-less "did not answer" marker (carries `note`) is an empty slot;
      // every other slot carries its body verbatim.
      text: note !== undefined ? "" : inner,
      ...(errorReason !== undefined ? { error: errorReason } : {}),
    };
  }

  // An empty wrapper (no summary AND no agent sections) is not a real turn.
  if (summaryText.length === 0 && Object.keys(answers).length === 0) return null;

  return { answers, summary: { status: "done", text: summaryText } };
}

/**
 * Drop the leading cosmetic `### Heading` line a section body opens with, if any.
 * Strips only that FIRST non-blank line and only when it's an ATX heading, so
 * answer prose using `###` further down is preserved.
 */
function stripLeadingHeading(sectionBody: string): string {
  const lines = sectionBody.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i < lines.length && /^#{1,6}\s/.test(lines[i].trim())) {
    return lines.slice(i + 1).join("\n");
  }
  return sectionBody;
}
