import { backendRegistry } from "@/agentMode/backends/registry";
import type {
  AgentAnswer,
  AgentAnswerStatus,
  FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";

/** The summary entry's reserved option value — never a valid `BackendId`. */
export const FANOUT_SUMMARY_OPTION = "__summary__";

/**
 * A selectable value in the fan-out switcher: {@link FANOUT_SUMMARY_OPTION} or
 * an agent's `BackendId`. Both are `string` (so this alias collapses to
 * `string`); the name documents the intent at call sites.
 */
export type FanoutOptionValue = BackendId;

/**
 * Presentational state of one agent's slot, derived from its live status (D7).
 * `running` shows a spinner over the streaming tokens, `done` shows the answer,
 * `error` shows an error chip, `cancelled` shows a muted cancelled chip (user
 * aborted the turn — a clean stop, not a fault). Decoupled from
 * {@link AgentAnswerStatus} so the renderer switches on intent, not raw status.
 */
export type FanoutAgentState = "streaming" | "answer" | "error" | "cancelled";

/** Map an agent answer's live status to its presentational state (D7). */
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
 * Presentational state of the summary slot when it has no text yet. Distinct
 * from a perpetual spinner: a cancelled turn skips summary generation (status
 * stays `pending` with no agent still running), and a failed summary lands
 * `done` with empty text — both are terminal and must not animate forever.
 * `writing`/`waiting` are the genuine in-progress spinners.
 */
export type FanoutSummaryState = "writing" | "waiting" | "cancelled" | "unavailable";

/**
 * Classify an empty summary slot for rendering. Call only when the summary has
 * no text. `streaming` → actively writing; `pending` with an agent still
 * running → waiting on answers; `pending` with every agent terminal → the turn
 * was cancelled before the summary ran; `done` with no text → summary failed.
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
 * One entry in the dropdown switcher. `value` is what the `Select` reports;
 * `label` + `Icon` render the row (registry-driven — no per-agent hardcoding).
 * The summary entry carries no icon. Agent entries carry their live `state`
 * so the dropdown can reflect streaming/error without re-reading the turn.
 */
export interface FanoutOption {
  value: FanoutOptionValue;
  label: string;
  /** Brand icon for an agent entry; `undefined` for the summary entry. */
  Icon?: AgentBrand["Icon"];
  /** Live state for an agent entry; `undefined` for the summary entry. */
  state?: FanoutAgentState;
}

/**
 * Resolve a `BackendId` to its registry brand (display name + icon). Falls back
 * to the id as the label when the backend is unknown, so a newly added backend
 * still renders sensibly without a per-agent branch.
 */
function brandFor(backendId: BackendId): { displayName: string; Icon?: AgentBrand["Icon"] } {
  const descriptor = backendRegistry[backendId];
  if (!descriptor) return { displayName: backendId };
  return { displayName: descriptor.displayName, Icon: descriptor.Icon };
}

/**
 * Resolve a `BackendId` to its registry display name (id fallback for an
 * unknown backend). Shared by the clean-composite renderer so the copied/
 * inserted headings match the rendered tab labels — same resolver, no
 * per-agent branch.
 */
export function fanoutDisplayName(backendId: BackendId): string {
  return brandFor(backendId).displayName;
}

/**
 * Derive the dropdown options for a fan-out turn: the summary first (D8 makes
 * it the default view), then one entry per agent in slot order (main agent
 * first). Pure — the presentational core unit-tested in isolation. Insertion
 * order of `turn.answers` is preserved so the main agent appears first.
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
      state: agentStateForStatus(answer.status),
    });
  }
  return options;
}

/**
 * The default selected option for a turn. Summary-first (D8): the summary is
 * always the default view. Kept as a function (rather than a constant) so a
 * future variant — e.g. select the main agent while the summary is still
 * pending — has a single seam to change.
 */
export function defaultFanoutOption(_turn: FanoutTurn): FanoutOptionValue {
  return FANOUT_SUMMARY_OPTION;
}

/**
 * The summary slot, or the answer slot for the given selection. Returns `null`
 * when the value names an agent that no longer has a slot (defensive — the
 * selection is always one of {@link buildFanoutOptions}' values in practice).
 */
export function selectedAnswer(turn: FanoutTurn, value: FanoutOptionValue): AgentAnswer | null {
  if (value === FANOUT_SUMMARY_OPTION) return null;
  return turn.answers[value] ?? null;
}
