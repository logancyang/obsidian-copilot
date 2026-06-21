import type {
  AgentChatMessage,
  AgentMessagePart,
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
 * Read-only QA preamble prepended to every fan-out agent's prompt (the
 * universal enforcement layer — D5 / the Assumption). It bounds the turn to a
 * single read-only answer while leaving the agent free to loop over non-write
 * tools (grep, read, web fetch/search, vault search) to answer well. The
 * per-backend permission denial and sandbox mode are belt-and-suspenders on top
 * of this instruction.
 */
export const FANOUT_READONLY_PREAMBLE =
  "You are answering a read-only question. Do NOT modify any files, run any " +
  "commands that change state, or execute write/shell tools — answer only. " +
  "You may freely read, search, grep, and fetch to inform your answer. " +
  "Respond with your analysis directly.";

/**
 * Per-turn fan-out state for a multi-agent QA turn. Held LIVE in memory on the
 * owning assistant message (`AgentChatMessage.fanout`) and PERSISTED to the
 * message body as a composite (see {@link serializeFanoutComposite}) so the
 * dropdown is reconstructed on reload (see {@link parseFanoutComposite}). The
 * main agent fills the summary once every answer settles (D6); the UI renders
 * the tab row over `answers`.
 */
export interface FanoutTurn {
  /**
   * One slot per ANSWERER (the deduped `@`-mentioned installed agents), keyed by
   * `BackendId`. The session main agent is the separate summarizer and has a
   * slot only if it was itself `@`-mentioned. Each answer streams into its own
   * slot independently (D7).
   */
  answers: Record<BackendId, AgentAnswer>;
  /**
   * The narrative summary slot, filled by the main agent over the surviving
   * answers (D6). The only part of the turn that persists.
   */
  summary: FanoutSummary;
}

/**
 * Live status of one agent's answer within a {@link FanoutTurn}.
 * `cancelled` is a distinct terminal state from `error`: the user aborted the
 * turn (not an agent fault), so the UI reads it as cancelled rather than a
 * failure. Both are terminal; neither feeds the summary.
 */
export type AgentAnswerStatus = "running" | "done" | "error" | "cancelled";

/**
 * One agent's slot in a fan-out turn. `text` accumulates streamed prose;
 * `error` carries a human-readable failure when `status === "error"` (including
 * a per-agent timeout) so one agent's failure never throws out of the
 * orchestrator and the others keep streaming.
 */
export interface AgentAnswer {
  backendId: BackendId;
  status: AgentAnswerStatus;
  text: string;
  error?: string;
}

/**
 * Per-agent answer timeout. A single hung/long-running sub-session must fail
 * ITS OWN slot without stalling the others or the summary, so each agent's
 * `prompt()` races this deadline; on expiry the orchestrator cancels that
 * sub-session and marks the slot `error` with {@link FANOUT_AGENT_TIMEOUT_ERROR}.
 * Five minutes is generous for a read-only QA answer (the agent may loop over
 * grep/read/fetch tools) while still bounding a wedged subprocess. Not a
 * user-facing setting (out of scope for v1).
 */
export const FANOUT_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

/** Human-readable reason set on a slot that exceeded {@link FANOUT_AGENT_TIMEOUT_MS}. */
export const FANOUT_AGENT_TIMEOUT_ERROR = "Timed out waiting for this agent to answer.";

/**
 * Grace window the orchestrator waits, after requesting `cancel`, for a
 * cancelled/timed-out sub-session's underlying `prompt()` to actually settle
 * before it lets that backend be reused (the summary reuses the main agent's
 * backend). `cancel` only interrupts — the backend query keeps unwinding, and
 * the Claude SDK backend's permission-bridge/session context is process-global
 * for the active query, so a second prompt on the same backend mid-unwind can
 * misroute permission decisions or corrupt the summary. Awaiting settlement
 * makes "settled" mean the query has truly stopped. Bounded so a backend that
 * ignores cancel cannot hang the turn forever — if the grace elapses we proceed
 * anyway (logged), preserving the timeout's bounded-wall-clock guarantee.
 */
export const FANOUT_CANCEL_GRACE_MS = 3 * 1000;

/**
 * Tail grace the orchestrator holds an ephemeral sub-session's update handler
 * open AFTER its `prompt()` resolves normally, before it unregisters the handler
 * and closes the session. Some ACP backends (opencode, fast models) flush a
 * turn's FINAL `agent_message_chunk` events just AFTER the `session/prompt`
 * result resolves; without this window those trailing chunks arrive once the
 * handler is already gone and are dropped, truncating an agent's answer (or the
 * summary) right at the end. The single-agent path keeps its session-level
 * handler alive permanently and re-routes such chunks onto a settled
 * placeholder; a fan-out sub-session is ephemeral and must close, so it instead
 * waits this short bounded window for the flush, then tears down.
 *
 * Kept SHORT: the flush is effectively immediate after the result resolves, so a
 * few hundred ms captures it without materially delaying turn completion.
 * Backends that emit no trailing chunks simply wait out a harmless window. Only
 * applied on the NORMAL resolve path — cancel/timeout intentionally suppress
 * late output and skip this wait (mirroring the single-agent "except on explicit
 * cancel" carve-out).
 */
export const FANOUT_TRAILING_CHUNK_GRACE_MS = 500;

/** Status of the main-agent narrative summary slot. */
export type FanoutSummaryStatus = "pending" | "streaming" | "done";

/** The summary slot — the only part of a fan-out turn that is persisted. */
export interface FanoutSummary {
  status: FanoutSummaryStatus;
  text: string;
  /**
   * True once the summary finished generating SUCCESSFULLY — not interrupted by
   * cancel, error, or timeout. `status` alone can't say (it is forced to `done`
   * on every exit so the UI never sticks on a spinner), so the single-agent
   * continuity replay uses this to decide whether to trust the summary text or
   * fall back to replaying the agents' answers. Live-only; never serialized.
   */
  complete?: boolean;
}

/**
 * Tool kinds that mutate the vault or execute commands. A fan-out QA
 * sub-session is read-only, so these are hard-denied while every other kind
 * (read / search / fetch / think / switch_mode / other) is allowed — the
 * agent may freely loop over non-write tools within its single turn (the
 * Assumption + Risk in the plan). `other` is intentionally allowed: denying it
 * would block legitimate read-only MCP tools, and the universal "answer only,
 * no writes" prompt instruction plus per-backend sandbox already steer the
 * agent away from mutations.
 */
const WRITE_OR_EXEC_KINDS: ReadonlySet<AgentToolKind> = new Set<AgentToolKind>([
  "edit",
  "delete",
  "move",
  "execute",
]);

/**
 * Whether a tool of the given kind must be denied in a read-only fan-out
 * sub-session. Pure; the canonical predicate behind the permission-prompter
 * read-only policy. `undefined` (kind not reported) is treated as a write to
 * fail safe — an unknown tool in a read-only turn should not slip through.
 */
export function isWriteOrExecToolKind(kind: AgentToolKind | undefined): boolean {
  if (kind === undefined) return true;
  return WRITE_OR_EXEC_KINDS.has(kind);
}

/**
 * The text persisted for a completed fan-out turn: the summary only. Per-agent
 * answers are live-only, so this is the single seam through which a multi-agent
 * turn reaches disk — guaranteeing no per-agent answer is ever serialized.
 *
 * Returns the trimmed summary text when present (the normal path, and the
 * zero-success all-failed note, which `runSummary` already wrote into the slot).
 * When the summary is empty BUT at least one agent succeeded — summary
 * generation threw, ended empty, or the turn was cancelled after answers
 * landed — falls back to {@link FANOUT_SUMMARY_UNAVAILABLE} so a turn with
 * SUCCESSFUL answers never reloads as a blank assistant bubble. A turn with no
 * successes and no summary (e.g. cancelled before any answer landed) collapses
 * to empty so the caller persists/buffers nothing.
 */
export function collapseFanoutTurnToSummaryText(turn: FanoutTurn): string {
  const text = turn.summary.text.trim();
  if (text.length > 0) return text;
  return selectSummaryInputs(turn).succeeded.length > 0 ? FANOUT_SUMMARY_UNAVAILABLE : "";
}

/**
 * A fresh, structurally-copied snapshot of a live fan-out turn. The orchestrator
 * mutates a single {@link FanoutTurn} in place and re-emits the SAME reference
 * on every streamed token (see `FanoutOrchestrator`). The UI subscribes through
 * React state, which bails on `Object.is`-equal updates — so handing the live
 * object straight to `setState` would freeze the dropdown on its first frame.
 * Copying the turn (and each answer slot) yields a new reference per query, so
 * each coalesced notify produces a render with the latest streamed text/status.
 * Copies the answer slots too so a captured snapshot stays stable even as the
 * live turn keeps mutating underneath it.
 */
export function snapshotFanoutTurn(turn: FanoutTurn): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of Object.keys(turn.answers)) {
    answers[backendId] = { ...turn.answers[backendId] };
  }
  return { answers, summary: { ...turn.summary } };
}

/**
 * Concise, provider-neutral instruction for the main agent's narrative summary
 * (Phase 3 / D6). It frames a NEW user turn — it never replaces any backend
 * system prompt — and asks for reconciling prose, not a structured table. It is
 * also read-only: the summary sub-session must not write, only synthesize the
 * answers it is handed.
 */
export const FANOUT_SUMMARY_INSTRUCTION =
  "You are a neutral synthesizer. The labeled blocks below are answers that " +
  "SEVERAL DIFFERENT AI agents each gave to the user's question. Write a " +
  "synthesis of THEIR answers for the user — you are reporting on what the agents " +
  "said, not answering the question yourself.\n\n" +
  "VOICE (critical):\n" +
  "- Write in the THIRD PERSON and attribute every point to the agent that made " +
  'it, by name — for example "<agent> reports that it …" or "<agent A> and ' +
  '<agent B> both note …".\n' +
  '- The agents wrote in the first person; convert their "I/my" into "<agent> ' +
  'says it …". NEVER write in the first person or speak as if the question were ' +
  'asked of you — no sentence may begin with "I".\n\n' +
  "SCOPE:\n" +
  "- Use ONLY the answers shown. Ignore any environment scaffolding they include " +
  "(tool lists, available skills/agents, system boilerplate). Do not mention how " +
  "many agents there were, who did not answer, or anything missing.\n\n" +
  "FORMAT:\n" +
  "- If only ONE agent answered: one to three sentences summarizing its answer, " +
  "attributed by name. No headings.\n" +
  "- If TWO OR MORE answered, use these markdown sections, omitting any that is " +
  "empty:\n" +
  '  "**Each agent**" — one concise bullet per agent: "**<agent>**: <gist>".\n' +
  '  "**Agreements**" — the points the agents share.\n' +
  '  "**Disagreements**" — where they differ, naming the agents on each side.\n' +
  "- Summarize; do not paste an agent's full answer back. Be concise.\n\n" +
  "Do NOT modify any files or run write/shell tools.";

/** The text persisted when every fan-out agent failed (D7 zero-success case). */
export const FANOUT_ALL_FAILED_SUMMARY =
  "All agents failed to answer; no summary could be generated.";

/**
 * The text persisted when at least one agent answered but the narrative summary
 * could not be generated (summary threw, ended empty, or the turn was cancelled
 * after answers landed). Without this, an empty summary would persist a blank
 * assistant bubble that discards a turn with successful answers on reload.
 */
export const FANOUT_SUMMARY_UNAVAILABLE =
  "Multiple agents answered this turn, but a combined summary could not be generated.";

/**
 * A fan-out turn the visible session's backend never saw. The whole turn runs
 * on ephemeral read-only sub-sessions, so the live backend has no record of it;
 * we buffer the user's question + the persisted summary and replay it as a
 * labeled prior-turn block on the next single-agent prompt to keep continuity.
 * LIVE-ONLY: never serialized (mirrors the no-migration decision).
 */
export interface PendingFanoutContext {
  /** The user's original prompt text for that fan-out turn. */
  question: string;
  /** The main agent's narrative summary — the only part of the turn persisted. */
  summary: string;
}

/** Frozen empty buffer — the referentially-stable "nothing pending" value. */
export const EMPTY_PENDING_FANOUT_CONTEXT: ReadonlyArray<PendingFanoutContext> = Object.freeze([]);

/**
 * Compose the buffered fan-out turns into a single labeled prior-turn context
 * block, prepended to the next single-agent prompt so the backend (which never
 * processed those turns) reads them as EARLIER conversation in this chat — not
 * as a fresh task. Pure. Returns `null` for an empty buffer so the caller can
 * leave the prompt byte-for-byte unchanged in the common case. Each entry is
 * wrapped in `<multi_agent_turn>` with labeled question/summary, consistent with
 * the `<web_*>` / context-envelope tag style used elsewhere in the prompt.
 */
export function buildPriorFanoutContextBlock(
  entries: ReadonlyArray<PendingFanoutContext>
): string | null {
  if (entries.length === 0) return null;
  // Escape the user-controlled question/summary so a `<` or a stray
  // `</summary>` can't break the framing — same convention as the sibling
  // `<web_*>` block builders in AgentSession.
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

/**
 * Per-tool-output char budget within a rendered turn. One verbose tool card
 * (a long grep dump or file read) must not dominate the history at the expense
 * of the surrounding conversation, so each tool output is trimmed to this head
 * length before the overall {@link FANOUT_HISTORY_MAX_CHARS} cap applies on top.
 */
const FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;

/** Trim `s` to its leading `max` chars, appending `marker` only when it actually overflows. */
function trimHead(s: string, max: number, marker: string): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n${marker}`;
}

/**
 * Concise, provider-neutral text for the renderable non-prose parts of an
 * assistant turn. Prose (`text` parts) is intentionally skipped here because
 * `AgentChatMessage.message` already aggregates every streamed text part (the
 * store keeps `displayText` in sync with the `text` parts), so rendering them
 * again would duplicate the prose. `thought` parts are omitted as internal
 * reasoning. Drives off part `kind` only — no per-agent-name branching:
 *   - `tool_call` → `[tool: <identity>]` plus the renderable text output,
 *     trimmed per part so one card can't dominate.
 *   - `plan` → `[plan]` plus each entry's status + content (so a follow-up like
 *     "review the plan above" has the plan to read).
 */
function renderNonProseParts(parts: readonly AgentMessagePart[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part.kind === "tool_call") {
      const identity = part.vendorToolName?.trim() || part.title.trim() || "tool";
      const outputText = (part.output ?? [])
        .filter((o): o is { type: "text"; text: string } => o.type === "text")
        .map((o) => o.text)
        .join("\n")
        .trim();
      const trimmed = trimHead(
        outputText,
        FANOUT_HISTORY_TOOL_OUTPUT_MAX_CHARS,
        FANOUT_HISTORY_TURN_TRUNCATION_MARKER
      );
      out.push(trimmed.length > 0 ? `[tool: ${identity}]\n${trimmed}` : `[tool: ${identity}]`);
    } else if (part.kind === "plan") {
      const lines = part.entries.map((e) => `- (${e.status}) ${e.content}`).join("\n");
      out.push(lines.length > 0 ? `[plan]\n${lines}` : "[plan]");
    }
    // `text` parts are already in `message` (prose); `thought` parts are omitted.
  }
  return out;
}

/**
 * Count the image attachment blocks in a user message's `content` array. The
 * field is typed `unknown[]` (display-only: `buildUserDisplayContent` projects
 * attached images into it), so each entry is narrowed defensively — a non-null
 * object whose `type` is a string equal to `"image"` or `"image_url"`. Both
 * shapes are matched: the live projection emits `image_url` entries, while the
 * underlying prompt block shape is `image`, so either form is recognized
 * without assuming a concrete type or casting. Non-object / non-image entries
 * (e.g. `text` blocks, `null`, strings) are ignored.
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
 * Concise marker noting that a turn carried image attachments whose bytes are
 * NOT included in fan-out history (only this signal that they existed). Singular
 * vs plural is correct so the marker reads naturally for one or many images.
 * Fully fixed text plus a count — nothing user-controlled, so no escaping is
 * needed here. Threading the actual image bytes into the prompt is a tracked
 * follow-up (full multimodal history); this marker only prevents silent context
 * loss in the meantime.
 */
function imageAttachmentMarker(count: number): string {
  const noun = count === 1 ? "image attachment" : "image attachments";
  return `[${count} ${noun} omitted from history; the image content is not included here but existed in this turn]`;
}

/**
 * Render a turn's attached {@link MessageContext} (the visible notes, selected
 * excerpts, folders, urls, tags, and web tabs the user pinned to that turn) into
 * a single `[context]` section so a fan-out agent — running a FRESH session with
 * no memory — can resolve a follow-up like "explain the selected excerpt above"
 * that the single-agent backend would have seen inline. PURE: renders ONLY what
 * is stored on the objects; full note/web-tab bodies are read from the vault at
 * prompt time and are NOT on `context` (a tracked follow-up), so this lists note
 * NAMES + the already-captured selection excerpts, never file contents.
 *
 * Highest value is `selectedTextContexts`: the excerpt `content` is the thing a
 * follow-up references, so each is rendered with its label and the actual text,
 * trimmed PER ITEM via {@link trimHead} (reusing the per-tool-output budget) so
 * one large excerpt can't dominate the surrounding history. Every other field
 * collapses to a concise identifier line. Empty/absent sub-fields are omitted;
 * an empty/undefined context renders NOTHING (the array is empty) so the turn is
 * byte-for-byte unchanged. Dynamic values (titles, excerpt content, urls, names)
 * are NOT escaped here: `buildConversationHistoryBlock` escapes the whole turn
 * body once, so escaping internally would double-encode — same convention as the
 * tool/plan renderers above, which also emit raw text. Drives off field presence
 * only, no per-agent-name branching.
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

  // Use the vault path, not the basename: a fan-out agent runs in a fresh
  // session, so the path is what lets its Read tool resolve a note in a folder
  // or disambiguate duplicate basenames.
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
    // Keep the URL alongside the title: the title alone can't be fetched or
    // identified by a fresh fan-out session.
    const tabs = context.webTabs.map((t) => (t.title ? `${t.title} (${t.url})` : t.url)).join(", ");
    lines.push(`[web tabs: ${tabs}]`);
  }

  if (lines.length === 0) return [];
  return [`[context]\n${lines.join("\n")}`];
}

/**
 * The renderable inner body of one transcript turn: its prose (from `message`,
 * which already aggregates the text parts), its non-prose parts (tool outputs,
 * plan entries), a marker for any image attachments on the turn's `content`,
 * then its attached {@link MessageContext} (pinned notes / selected excerpts /
 * tabs). Returns `null` only when the turn carries NO renderable content at all
 * — prose, parts, images, AND context all absent. A turn that is ONLY context
 * (empty prose, no parts/images) now renders its `[context]` section so it is no
 * longer dropped from history; a turn with no context renders byte-for-byte as
 * before.
 */
function renderTurnContent(message: AgentChatMessage): string | null {
  const segments: string[] = [];
  const prose = message.message.trim();
  if (prose.length > 0) segments.push(prose);
  if (message.parts) segments.push(...renderNonProseParts(message.parts));
  const imageCount = countImageAttachments(message.content);
  if (imageCount > 0) segments.push(imageAttachmentMarker(imageCount));
  segments.push(...renderMessageContext(message.context));
  if (segments.length === 0) return null;
  return segments.join("\n");
}

/**
 * Render the prior visible transcript into a single read-only
 * `<conversation_history>` block for fan-out agent prompts (D2 / realizes D9).
 * Each fan-out agent opens a FRESH session with no memory, so this is how it
 * sees what came before — framed as context to USE, not a task to redo or
 * re-answer.
 *
 * `messages` must be PRIOR turns only (the caller excludes the current
 * in-flight user message + assistant placeholder). Each turn is labeled by role
 * (`user` / `assistant`) and rendered from its FULL visible content: prose plus
 * tool-call outputs and plan entries (thoughts omitted), so a follow-up like
 * "explain the command output above" or "review the plan above" has the context
 * the single-agent backend memory would have carried. A turn is skipped only
 * when it has no renderable content at all. Content is XML-escaped (same
 * convention as the `<web_*>` / prior-turns builders) so message text can't
 * break the framing.
 *
 * The result is bounded by `maxChars` (plus the small, constant framing chrome
 * and truncation markers) for ANY input: oldest turns are dropped first, and if
 * a single retained turn still overflows it is itself truncated to the cap.
 * Returns `null` when there is no prior history (empty input or all-empty) so
 * the caller leaves the fan-out prompt byte-for-byte unchanged.
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
 * The agents whose answers feed the summary, partitioned for failure-awareness
 * (D7): `succeeded` are `done` slots with non-empty text (the summary
 * reconciles these); `failed` are slots that errored OR finished empty (the
 * summary notes them by name). Insertion order is preserved on both lists,
 * matching the answer-slot order.
 */
export interface SummaryInputs {
  succeeded: SucceededAnswer[];
  failed: BackendId[];
}

/**
 * Partition a settled turn's answers into the {@link SummaryInputs} the summary
 * runs over. Pure — the failure-aware core of Phase 3. A `done` slot with only
 * whitespace is treated as a failure: it carries nothing to reconcile, so the
 * summary names it rather than feeding the main agent an empty answer.
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
 * Compose the NEW user-turn prompt fed to the main agent for the summary: the
 * read-only summary instruction, the user's original prompt, then each
 * succeeded answer labeled by its agent's display name, and a closing note
 * listing any agents that failed (D7). Returns a single text block so the
 * summary sub-session sees one coherent prompt. `displayNameFor` resolves a
 * `BackendId` to its human label; it falls back to the id when unknown so a
 * newly added backend still renders sensibly (no per-agent branching).
 *
 * Returns `null` when zero agents succeeded — the caller must not fabricate a
 * summary over nothing; it sets the zero-success terminal state instead.
 */
export function buildSummaryUserPrompt(
  originalPrompt: string,
  inputs: SummaryInputs,
  displayNameFor: (backendId: BackendId) => string
): PromptContent[] | null {
  if (inputs.succeeded.length === 0) return null;
  // `text` is already trimmed by selectSummaryInputs — no re-trim.
  const sections = inputs.succeeded.map(
    ({ backendId, text }) => `### ${displayNameFor(backendId)}\n${text}`
  );
  // Only the SUCCEEDED answers are shown to the summarizer. Agents that did not
  // answer are intentionally omitted entirely (not listed as a "gap") so the
  // summary can't mention or speculate about them — it sees only real answers.
  const parts = [
    FANOUT_SUMMARY_INSTRUCTION,
    `## Question\n${originalPrompt.trim()}`,
    `## Agent answers\n${sections.join("\n\n")}`,
  ];
  return [{ type: "text", text: parts.join("\n\n") }];
}

/**
 * Generous char cap on EACH persisted agent answer in the composite body. The
 * dropdown reconstructed on reload shows full per-agent answers, but an
 * unbounded answer (a multi-thousand-line dump from one agent) would bloat the
 * saved note; this caps each answer's persisted text while staying large enough
 * that a normal QA answer is never clipped. Independent of the prompt-time
 * {@link FANOUT_HISTORY_MAX_CHARS} (that bounds the model API input; this bounds
 * the on-disk transcript). Only the per-agent answer bodies are capped — the
 * summary is persisted in full as it is the primary shown artifact.
 */
export const FANOUT_PERSISTED_ANSWER_MAX_CHARS = 24_000;

/** Inline marker appended when a persisted agent answer is truncated to fit the cap. */
const FANOUT_PERSISTED_ANSWER_TRUNCATION_MARKER = "[answer truncated]";

/** Composite format version, embedded in the opening marker for forward-compat. */
const FANOUT_COMPOSITE_VERSION = 1;

/** Opening marker that flags an assistant body as a serialized fan-out composite. */
const FANOUT_MARKER_OPEN = `<!--copilot:multi-agent v=${FANOUT_COMPOSITE_VERSION}-->`;

/** Sentinel that {@link parseFanoutComposite} keys on to detect a composite body (version-agnostic). */
const FANOUT_MARKER_PREFIX = "<!--copilot:multi-agent";

/** Closing marker of a serialized fan-out composite. */
const FANOUT_MARKER_CLOSE = "<!--copilot:multi-agent-end-->";

/** Section marker introducing the summary block. */
const FANOUT_MARKER_SUMMARY = "<!--copilot:summary-->";

/**
 * Marker-escape sentinel: a Private-Use-Area codepoint that will not occur in
 * normal prose. An answer may legitimately contain the literal marker prefix
 * (e.g. an agent quoting this very format); writing it verbatim would let that
 * text forge a section marker and corrupt the parse. We neutralize the COLON
 * after `copilot` on write and restore it on read.
 *
 * The scheme is fully lossless even when the answer ALSO already contains the
 * sentinel itself: we first escape every literal sentinel as `S` + `0`, then
 * escape each marker colon as `S` + `1`. Because all pre-existing sentinels are
 * already doubled by the time the colon escape runs, the two escapes never
 * collide, and the read side (longest-match `S0`\u2192`S`, `S1`\u2192`:`-in-marker)
 * reverses both unambiguously. Without the sentinel-doubling step, an answer
 * containing the raw escaped byte sequence would be silently corrupted on read.
 */
const FANOUT_MARKER_SENTINEL = "\uE000";
const FANOUT_SENTINEL_LITERAL_ESCAPE = `${FANOUT_MARKER_SENTINEL}0`;
const FANOUT_SENTINEL_COLON_ESCAPE = `${FANOUT_MARKER_SENTINEL}1`;
const FANOUT_LITERAL_MARKER_PREFIX = "<!--copilot:";
const FANOUT_ESCAPED_MARKER_PREFIX = `<!--copilot${FANOUT_SENTINEL_COLON_ESCAPE}`;

/**
 * Escape body text so it can never forge a section marker and round-trips
 * losslessly. Order matters: double any literal sentinel FIRST so the
 * subsequently-introduced colon escapes are the only single-sentinel sequences.
 */
function escapeFanoutMarkers(text: string): string {
  return text
    .split(FANOUT_MARKER_SENTINEL)
    .join(FANOUT_SENTINEL_LITERAL_ESCAPE)
    .split(FANOUT_LITERAL_MARKER_PREFIX)
    .join(FANOUT_ESCAPED_MARKER_PREFIX);
}

/**
 * Inverse of {@link escapeFanoutMarkers}. Restore the colon-marker escapes
 * FIRST, then collapse the doubled literal sentinels \u2014 the mirror of the write
 * order so both layers reverse exactly.
 */
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

/** Short note emitted (in the `note` attribute) for an agent that produced no answer. */
const FANOUT_NO_ANSWER_NOTE = "did not answer";

/**
 * Serialize a completed fan-out turn into the PERSISTED assistant message body:
 * a composite of the summary plus each SUCCEEDED agent's answer, delimited by
 * HTML-comment section markers so a reload can reconstruct the dropdown
 * ({@link parseFanoutComposite}) while a marker-unaware renderer still shows
 * readable markdown (the `### Heading` lines are cosmetic; the parse keys ONLY
 * on the comment markers). A failed/cancelled agent persists its PARTIAL text
 * (so reload matches the live tab) when it streamed any, else a body-less marker
 * carrying its `status` + a short `note`; the summary still excludes it. Each
 * persisted answer is capped ({@link FANOUT_PERSISTED_ANSWER_MAX_CHARS}) and its
 * inner text is marker-escaped so it can never forge a section.
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
      // A failed/cancelled agent. If it streamed partial text before stopping,
      // persist that text (with its terminal status) so a reload matches the
      // live tab, which shows it; a truly empty slot gets a body-less marker
      // recording that it participated and did not answer. Either way the
      // summary still excludes it (selectSummaryInputs treats it as failed).
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
 * The CLEAN composite (markers stripped) for copy / insert of the WHOLE turn:
 * readable markdown with the summary, each succeeded agent's answer under a
 * heading, and a one-line "did not answer" note per failed agent. Independent
 * of the persisted body so the user copies prose, never the invisible markers.
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
      // A terminal slot that streamed partial text keeps it (matching the
      // persisted body and the live tab); a truly empty one gets the note.
      const partial = slot.text.trim();
      sections.push(
        partial.length > 0 ? `### ${name}\n${partial}` : `### ${name}\n_${FANOUT_NO_ANSWER_NOTE}_`
      );
    }
  }

  return sections.join("\n\n");
}

/**
 * Escape a value placed inside a marker attribute so it can't break the comment
 * or the parser: `--` would close/confuse the HTML comment, `"` would end the
 * attribute, and `>` would terminate the marker early (the parser matches agent
 * markers with `agent[^>]*`). Backend-controlled text (e.g. an agent error like
 * `expected >`) flows through here, so all three must be neutralized.
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
  // `running` is never persisted (the turn is terminal on save); any unknown
  // value is treated as a non-success so the slot reads as a failed answer.
  return "error";
}

/**
 * Inverse of {@link serializeFanoutComposite}. Returns `null` when `body` is a
 * plain/old assistant message (no composite marker) so the caller leaves it
 * unchanged. When present, reconstructs a {@link FanoutTurn} with terminal
 * statuses, keying ONLY on the HTML-comment section markers (the cosmetic
 * `### Heading` lines are ignored). Round-trips with serialize; inner text is
 * marker-unescaped so an answer that literally contained `<!--copilot:` is
 * restored verbatim.
 */
export function parseFanoutComposite(body: string): FanoutTurn | null {
  if (!body.includes(FANOUT_MARKER_PREFIX)) return null;

  const answers: Record<BackendId, AgentAnswer> = {};
  let summaryText = "";

  // Split on every section marker, tagging each chunk with the marker that
  // opened it. The leading chunk (before the open marker) and the trailing
  // chunk (after the end marker) are framing chrome and ignored.
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
      // A body-less "did not answer" marker (carries `note`) reconstructs an
      // empty slot; every other slot — a `done` answer or a terminal slot with
      // partial text — carries its body verbatim.
      text: note !== undefined ? "" : inner,
      ...(errorReason !== undefined ? { error: errorReason } : {}),
    };
  }

  return { answers, summary: { status: "done", text: summaryText } };
}

/**
 * Drop the leading cosmetic `### Heading` line a section body opens with (if
 * any) so it is not folded back into the reconstructed text. Skips the blank
 * line that the marker-join leaves before the heading, strips only that FIRST
 * non-blank line and only when it is an ATX heading, so answer prose that itself
 * uses `###` headings further down is preserved.
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
