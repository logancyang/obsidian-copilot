import {
  isDirectAnswerTurn,
  type AgentAnswer,
  type AgentAnswerStatus,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";

/** The summary entry's reserved option value — never a valid agent slug. */
export const FANOUT_SUMMARY_OPTION = "__summary__";

/** A selectable value: {@link FANOUT_SUMMARY_OPTION} or an agent's slug. */
export type FanoutOptionValue = string;

/**
 * Presentational state of one agent's slot, derived from its live status.
 * Decoupled from {@link AgentAnswerStatus} so the renderer switches on intent.
 * `empty` is a slot that finished but produced no text (the agent did not
 * answer) — terminal, so it must not show a spinner or a success check.
 */
export type FanoutAgentState = "streaming" | "answer" | "error" | "cancelled" | "empty";

/** Map an agent answer's live status to its presentational state. */
export function agentStateForStatus(status: AgentAnswerStatus): FanoutAgentState {
  switch (status) {
    case "running":
      return "streaming";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    case "done":
      return "answer";
  }
}

/**
 * Like {@link agentStateForStatus} but resolves a `done` slot with no text to
 * `empty` — so it renders as "did not answer" instead of a misleading success
 * check (the slot finished without producing an answer).
 */
export function agentStateForAnswer(answer: AgentAnswer): FanoutAgentState {
  if (answer.status === "done" && answer.text.trim().length === 0) return "empty";
  return agentStateForStatus(answer.status);
}

/**
 * Presentational state of an empty summary slot. `writing`/`waiting` are the
 * genuine in-progress spinners; `cancelled`/`unavailable` are terminal and must
 * not animate forever.
 */
export type FanoutSummaryState = "writing" | "waiting" | "cancelled" | "unavailable";

/**
 * Classify an empty summary slot for rendering. `streaming` → writing; `pending`
 * with an agent running → waiting; `pending` all-terminal → cancelled before
 * summary; `done` empty → summary failed.
 */
export function summaryDisplayState(turn: FanoutTurn): FanoutSummaryState {
  if (turn.summary.status === "streaming") return "writing";
  if (turn.summary.status === "pending") {
    const anyRunning = Object.values(turn.answers).some((a) => a.status === "running");
    return anyRunning ? "waiting" : "cancelled";
  }
  return "unavailable";
}

/**
 * One entry in the dropdown switcher. `label` + `icon` render the row, read off
 * the answer slot so a renamed or deleted agent still labels its own tab. The
 * summary entry carries no icon/state.
 */
export interface FanoutOption {
  value: FanoutOptionValue;
  label: string;
  /** The agent's emoji; `undefined` for the summary entry, empty for an agent with none. */
  icon?: string;
  /** Live state for an agent entry; `undefined` for the summary entry. */
  state?: FanoutAgentState;
}

/**
 * Derive the dropdown options: one direct agent entry for a single answer;
 * otherwise the summary first, then agents in mention order.
 */
export function buildFanoutOptions(turn: FanoutTurn): FanoutOption[] {
  const options: FanoutOption[] = isDirectAnswerTurn(turn)
    ? []
    : [{ value: FANOUT_SUMMARY_OPTION, label: "Summary" }];
  for (const slug of Object.keys(turn.answers)) {
    const answer = turn.answers[slug];
    options.push({
      value: slug,
      label: answer.name,
      icon: answer.icon,
      state: agentStateForAnswer(answer),
    });
  }
  return options;
}

/** The default selected option: the sole agent for a direct response, otherwise the summary. */
export function defaultFanoutOption(turn: FanoutTurn): FanoutOptionValue {
  return isDirectAnswerTurn(turn) ? Object.keys(turn.answers)[0] : FANOUT_SUMMARY_OPTION;
}

/**
 * The summary slot (`null`), or the answer slot for the selection. `null` too
 * when the value names an agent with no slot (defensive).
 */
export function selectedAnswer(turn: FanoutTurn, value: FanoutOptionValue): AgentAnswer | null {
  if (value === FANOUT_SUMMARY_OPTION) return null;
  return turn.answers[value] ?? null;
}
