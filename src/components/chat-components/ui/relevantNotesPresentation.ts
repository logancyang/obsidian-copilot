import type { RelevantNotesSearchStatus } from "@/search/findRelevantNotes";

export type RelevantNotesPaneStatus = RelevantNotesSearchStatus | "idle" | "loading";
export type RelevantNotesIndexingReviewDestination = "miyo" | "settings";
export type RelevantNotesGuidanceActionId =
  | "download"
  | "open-settings"
  | "refresh"
  | "review-indexing";

export interface RelevantNotesGuidanceAction {
  id: RelevantNotesGuidanceActionId;
  label: string;
}

export interface RelevantNotesGuidance {
  id: "download" | "unavailable" | "no-matches" | "not-indexed";
  title: string;
  description: string;
  actions: readonly RelevantNotesGuidanceAction[];
}

export interface RelevantNotesPresentation {
  showPane: boolean;
  showRows: boolean;
  layout: "empty" | "results";
  guidance: RelevantNotesGuidance | null;
}

const NO_ACTIONS = Object.freeze([]) satisfies readonly RelevantNotesGuidanceAction[];

const DOWNLOAD_GUIDANCE: RelevantNotesGuidance = Object.freeze({
  id: "download",
  title: "Add semantic matches with Miyo",
  description: "Download Miyo, then connect it in Copilot settings to find related notes.",
  actions: Object.freeze([
    { id: "download", label: "Download Miyo" },
    { id: "open-settings", label: "Set up in Copilot" },
  ] satisfies RelevantNotesGuidanceAction[]),
});

const UNAVAILABLE_GUIDANCE: RelevantNotesGuidance = Object.freeze({
  id: "unavailable",
  title: "Check your Miyo setup",
  description: "Check your connection and make sure this vault is registered and indexed.",
  actions: Object.freeze([
    { id: "open-settings", label: "Open Miyo settings" },
  ] satisfies RelevantNotesGuidanceAction[]),
});

const NO_MATCHES_GUIDANCE: RelevantNotesGuidance = Object.freeze({
  id: "no-matches",
  title: "No semantic matches yet",
  description: "Miyo is connected, but no related notes were found.",
  actions: NO_ACTIONS,
});

const NOT_INDEXED_GUIDANCE: Record<RelevantNotesIndexingReviewDestination, RelevantNotesGuidance> =
  {
    miyo: Object.freeze({
      id: "not-indexed",
      title: "This note isn't indexed in Miyo",
      description:
        "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings.",
      actions: Object.freeze([
        { id: "refresh", label: "Refresh" },
        { id: "review-indexing", label: "Open Miyo" },
      ] satisfies RelevantNotesGuidanceAction[]),
    }),
    settings: Object.freeze({
      id: "not-indexed",
      title: "This note isn't indexed in Miyo",
      description:
        "It may still be indexing or be excluded from Miyo. Review the configured Miyo connection or server in Copilot.",
      actions: Object.freeze([
        { id: "refresh", label: "Refresh" },
        { id: "review-indexing", label: "Review Miyo connection" },
      ] satisfies RelevantNotesGuidanceAction[]),
    }),
  };

interface RelevantNotesStatePresentation {
  showPane: boolean;
  showRows: boolean;
  guidance:
    | RelevantNotesGuidance
    | null
    | Record<RelevantNotesIndexingReviewDestination, RelevantNotesGuidance>;
}

// Search status is the sole input for user-facing state. Miyo establishes
// matches versus no matches, while the injected destination only selects the
// safe handoff for an unindexed note.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/280
const PRESENTATION_BY_STATUS: Record<RelevantNotesPaneStatus, RelevantNotesStatePresentation> = {
  idle: { showPane: true, showRows: false, guidance: null },
  loading: { showPane: false, showRows: false, guidance: null },
  disabled: { showPane: true, showRows: false, guidance: DOWNLOAD_GUIDANCE },
  unavailable: { showPane: true, showRows: false, guidance: UNAVAILABLE_GUIDANCE },
  matches: { showPane: true, showRows: true, guidance: null },
  "no-matches": { showPane: true, showRows: true, guidance: NO_MATCHES_GUIDANCE },
  "not-indexed": { showPane: true, showRows: true, guidance: NOT_INDEXED_GUIDANCE },
};

/**
 * Resolve a complete pane presentation without exposing Miyo state decisions to React rendering.
 *
 * @param status - Current lifecycle or settled Relevant Notes search status.
 * @param hasRows - Whether the current result contains renderable note rows.
 * @param reviewDestination - Runtime-safe destination for reviewing an unindexed note.
 * @returns Visibility, layout, guidance copy, and generic actions for the pane.
 */
export function getRelevantNotesPresentation(
  status: RelevantNotesPaneStatus,
  hasRows: boolean,
  reviewDestination: RelevantNotesIndexingReviewDestination
): RelevantNotesPresentation {
  const presentation = PRESENTATION_BY_STATUS[status];
  const guidance =
    presentation.guidance && "miyo" in presentation.guidance
      ? presentation.guidance[reviewDestination]
      : presentation.guidance;
  return {
    showPane: presentation.showPane,
    showRows: presentation.showRows,
    layout: presentation.showRows && hasRows ? "results" : "empty",
    guidance,
  };
}
