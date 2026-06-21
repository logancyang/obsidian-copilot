import type { AgentToolKind, BackendId } from "@/agentMode/session/types";

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
 * no-migration decision). Phase 3 fills the summary; Phase 4 renders the
 * dropdown over `answers`.
 */
export interface FanoutTurn {
  /**
   * One slot per participating agent (main agent first, then each
   * `@`-mentioned agent), keyed by `BackendId`. Each agent's answer streams
   * into its own slot independently (D7).
   */
  answers: Record<BackendId, AgentAnswer>;
  /**
   * The narrative summary slot. Phase 2 leaves this `pending` and never
   * generates content — it is the typed hook Phase 3 fills and the only part
   * of the turn that persists.
   */
  summary: FanoutSummary;
}

/** Live status of one agent's answer within a {@link FanoutTurn}. */
export type AgentAnswerStatus = "running" | "done" | "error";

/**
 * One agent's slot in a fan-out turn. `text` accumulates streamed prose;
 * `error` carries a human-readable failure when `status === "error"` so one
 * agent's failure never throws out of the orchestrator (full partial-failure
 * polish is Phase 5).
 */
export interface AgentAnswer {
  backendId: BackendId;
  status: AgentAnswerStatus;
  text: string;
  error?: string;
}

/** Status of the main-agent narrative summary slot. Content is Phase 3. */
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
 * content yet (Phase 2 always returns empty since the summary stays pending).
 */
export function collapseFanoutTurnToSummaryText(turn: FanoutTurn): string {
  return turn.summary.text.trim();
}
