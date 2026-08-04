import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";

/**
 * Readiness of one agent as the select view words it. Deliberately narrower than
 * `InstallState`: the view only distinguishes states the user can act on, and it
 * is never rendered while a readiness check is in flight.
 */
export type AgentSelectStatus = "connected" | "outdated" | "absent" | "error";

/** One agent row in the select view. */
export interface AgentSelectRow {
  id: BackendId;
  name: string;
  description: string;
  highlights: ReadonlyArray<string>;
  status: AgentSelectStatus;
  /** True for the single backend a first-run user is steered to. */
  recommended: boolean;
  /**
   * Operator-facing detail behind a non-`connected` status, carried straight
   * from `InstallState.message` so version prose is never re-derived here.
   * `null` when the install state has no message to offer.
   */
  statusMessage: string | null;
}

/** What the view's single call to action does for the selected row. */
export type AgentSelectAction = "start" | "configure";

/** Label, explanatory note, and behavior of the select view's one call to action. */
export interface AgentSelectCta {
  label: string;
  /** Footer text beside the button, explaining what pressing it will do. */
  note: string;
  action: AgentSelectAction;
}

const READY_NOTE = "Ready to go. You can switch agents any time from the agent picker.";

const EMPTY_AGENT_SELECT_ROWS: readonly AgentSelectRow[] = Object.freeze([]);

/**
 * Narrow a backend's install state to the vocabulary the select view renders.
 *
 * `checking` collapses to `absent`: it is a transient state only Claude enters,
 * and Step 5's integration keeps the compact status card on screen for it, so it
 * never reaches this view. Folding it into the most conservative "not usable
 * yet" bucket keeps the UI vocabulary at four states instead of inventing a
 * fifth that nothing renders.
 */
function toSelectStatus(kind: InstallState["kind"]): AgentSelectStatus {
  switch (kind) {
    case "ready":
      return "connected";
    case "incompatible":
      return "outdated";
    case "error":
      return "error";
    case "absent":
    case "checking":
      return "absent";
  }
}

function statusMessageOf(state: InstallState): string | null {
  return state.kind === "incompatible" || state.kind === "error" ? state.message : null;
}

/**
 * Project the registered backends onto the select view's row model, preserving
 * the caller's descriptor order so a single ordering source stays authoritative.
 * @param descriptors - Backends to list, already in display order.
 * @param states - Latest install state per backend id; a missing entry is treated as not set up.
 * @param recommendedId - The backend to mark as recommended, at most one row.
 */
export function buildAgentSelectRows(
  descriptors: readonly BackendDescriptor[],
  states: Partial<Record<BackendId, InstallState>>,
  recommendedId: BackendId
): readonly AgentSelectRow[] {
  if (descriptors.length === 0) return EMPTY_AGENT_SELECT_ROWS;
  return descriptors.map((descriptor) => {
    const state = states[descriptor.id] ?? { kind: "absent" as const };
    return {
      id: descriptor.id,
      name: descriptor.displayName,
      description: descriptor.setupDescription,
      // Handed through by reference: descriptors own frozen arrays (the empty
      // case is the shared `NO_SETUP_HIGHLIGHTS`), so rebuilding rows never
      // hands consumers a fresh identity for unchanged highlights.
      highlights: descriptor.setupHighlights,
      status: toSelectStatus(state.kind),
      recommended: descriptor.id === recommendedId,
      statusMessage: statusMessageOf(state),
    };
  });
}

/**
 * Resolve the one call to action the select view ends in. A connected agent can
 * be started; everything else routes to that agent's Configure dialog, with the
 * note explaining why.
 * @param row - The currently selected row.
 */
export function resolveAgentSelectCta(row: AgentSelectRow): AgentSelectCta {
  if (row.status === "connected") {
    return { label: "Start chat", note: READY_NOTE, action: "start" };
  }
  return {
    label: "Configure",
    note: row.statusMessage ?? `${row.name} isn't set up on this machine yet.`,
    action: "configure",
  };
}
