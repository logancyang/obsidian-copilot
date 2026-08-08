import { backendRegistry } from "@/agentMode/backends/registry";
import type {
  AgentAnswer,
  AgentAnswerStatus,
  FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";

/** The summary entry's reserved option value — never a valid `BackendId`. */
export const FANOUT_SUMMARY_OPTION = "__summary__";

/** A selectable value: {@link FANOUT_SUMMARY_OPTION} or an agent's `BackendId`. */
export type FanoutOptionValue = BackendId;

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
 * One entry in the dropdown switcher. `label` + `Icon` render the row
 * (registry-driven). The summary entry carries no icon/state.
 */
export interface FanoutOption {
  value: FanoutOptionValue;
  label: string;
  /** Brand icon for an agent entry; `undefined` for the summary entry. */
  Icon?: AgentBrand["Icon"];
  /** Live state for an agent entry; `undefined` for the summary entry. */
  state?: FanoutAgentState;
}

/** Resolve a `BackendId` to its registry brand (display name + icon); id fallback if unknown. */
function brandFor(backendId: BackendId): { displayName: string; Icon?: AgentBrand["Icon"] } {
  const descriptor = backendRegistry[backendId];
  if (!descriptor) return { displayName: backendId };
  return { displayName: descriptor.displayName, Icon: descriptor.Icon };
}

/**
 * Resolve a `BackendId` to its display name. Shared by the clean-composite
 * renderer so copied/inserted headings match the rendered tab labels.
 */
export function fanoutDisplayName(backendId: BackendId): string {
  return brandFor(backendId).displayName;
}

/**
 * Derive the dropdown options: the summary first (the default view), then one
 * entry per agent in slot order (insertion order preserved).
 */
export function buildFanoutOptions(turn: FanoutTurn): FanoutOption[] {
  const options: FanoutOption[] = [{ value: FANOUT_SUMMARY_OPTION, label: "Summary" }];
  for (const backendId of Object.keys(turn.answers)) {
    const answer = turn.answers[backendId];
    const { displayName, Icon } = brandFor(backendId);
    options.push({
      value: backendId,
      label: displayName,
      Icon,
      state: agentStateForAnswer(answer),
    });
  }
  return options;
}

/** The default selected option: always the summary. A function for a single future seam. */
export function defaultFanoutOption(_turn: FanoutTurn): FanoutOptionValue {
  return FANOUT_SUMMARY_OPTION;
}

/**
 * The summary slot (`null`), or the answer slot for the selection. `null` too
 * when the value names an agent with no slot (defensive).
 */
export function selectedAnswer(turn: FanoutTurn, value: FanoutOptionValue): AgentAnswer | null {
  if (value === FANOUT_SUMMARY_OPTION) return null;
  return turn.answers[value] ?? null;
}
