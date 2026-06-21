import type { AgentToolKind, BackendId, PromptContent } from "@/agentMode/session/types";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";

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
 * Per-turn fan-out state for a multi-agent QA turn (Phase 2). LIVE-ONLY: this
 * shape is never serialized. On save the turn collapses to just its
 * {@link FanoutSummary} text, written as an ordinary assistant message, so
 * existing single-agent transcripts load byte-for-byte unchanged (the t4
 * no-migration decision). The main agent fills the summary once every answer
 * settles (D6); Phase 4 renders the dropdown over `answers`.
 */
export interface FanoutTurn {
  /**
   * One slot per participating agent (main agent first, then each
   * `@`-mentioned agent), keyed by `BackendId`. Each agent's answer streams
   * into its own slot independently (D7).
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

/** Status of the main-agent narrative summary slot. */
export type FanoutSummaryStatus = "pending" | "streaming" | "done";

/** The summary slot — the only part of a fan-out turn that is persisted. */
export interface FanoutSummary {
  status: FanoutSummaryStatus;
  text: string;
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
 * Returns the trimmed summary text, or an empty string when the summary has no
 * content (e.g. the zero-success all-failed note is still written, but a
 * never-generated summary collapses to empty).
 */
export function collapseFanoutTurnToSummaryText(turn: FanoutTurn): string {
  return turn.summary.text.trim();
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
  "Several AI agents independently answered the question below. Write a single " +
  "narrative summary that reconciles and contrasts their answers: highlight " +
  "where they agree, where they diverge, and any unique points worth keeping. " +
  "Do NOT modify any files or run write/shell tools — answer only. Write " +
  "flowing prose, not a table or bullet list of each agent verbatim.";

/** The text persisted when every fan-out agent failed (D7 zero-success case). */
export const FANOUT_ALL_FAILED_SUMMARY =
  "All agents failed to answer; no summary could be generated.";

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

/** One agent's succeeded answer, ready to feed into the summary prompt. */
export interface SucceededAnswer {
  backendId: BackendId;
  text: string;
}

/**
 * The agents whose answers feed the summary, partitioned for failure-awareness
 * (D7): `succeeded` are `done` slots with non-empty text (the summary
 * reconciles these); `failed` are slots that errored OR finished empty (the
 * summary notes them by name). Insertion order is preserved on both lists so
 * the main agent appears first, matching the answer slots.
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
  const parts = [
    FANOUT_SUMMARY_INSTRUCTION,
    `## Original question\n${originalPrompt.trim()}`,
    `## Agent answers\n${sections.join("\n\n")}`,
  ];
  if (inputs.failed.length > 0) {
    const names = inputs.failed.map(displayNameFor).join(", ");
    parts.push(
      `## Note\nThese agents did not return an answer: ${names}. Summarize only the answers above and note this gap.`
    );
  }
  return [{ type: "text", text: parts.join("\n\n") }];
}
