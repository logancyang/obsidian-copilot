import { Button } from "@/components/ui/button";
import {
  getRelevantNotesPresentation,
  type RelevantNotesGuidance,
  type RelevantNotesGuidanceAction,
  type RelevantNotesGuidanceActionId,
  type RelevantNotesIndexingReviewDestination,
  type RelevantNotesPaneStatus,
} from "@/components/chat-components/ui/relevantNotesPresentation";
import { Download } from "lucide-react";
import React from "react";

interface RelevantNotesIndexingReviewAction {
  destination: RelevantNotesIndexingReviewDestination;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface RelevantNotesPaneActions {
  miyoDownloadUrl: string;
  onOpenMiyoSettings: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRefresh: () => void;
  reviewIndexing: RelevantNotesIndexingReviewAction;
}

export interface RelevantNotesPaneProps {
  status: RelevantNotesPaneStatus;
  noteRows: readonly React.ReactNode[];
  actions: RelevantNotesPaneActions;
}

type GuidanceActionRenderer = (
  action: RelevantNotesGuidanceAction,
  actions: RelevantNotesPaneActions
) => React.ReactNode;

interface GuidancePanelProps {
  guidance: RelevantNotesGuidance;
  actions: RelevantNotesPaneActions;
}

const GUIDANCE_ACTION_RENDERERS: Record<RelevantNotesGuidanceActionId, GuidanceActionRenderer> = {
  download: (action, actions) => (
    <Button asChild variant="secondary" size="sm">
      <a href={actions.miyoDownloadUrl} target="_blank" rel="noopener noreferrer">
        <Download className="tw-size-3.5" />
        {action.label}
      </a>
    </Button>
  ),
  "open-settings": (action, actions) => (
    <Button variant="default" size="sm" onClick={actions.onOpenMiyoSettings}>
      {action.label}
    </Button>
  ),
  refresh: (action, actions) => (
    <Button variant="secondary" size="sm" onClick={actions.onRefresh}>
      {action.label}
    </Button>
  ),
  "review-indexing": (action, actions) => (
    <Button variant="default" size="sm" onClick={actions.reviewIndexing.onSelect}>
      {action.label}
    </Button>
  ),
};

function GuidancePanel({ guidance, actions }: GuidancePanelProps): React.ReactElement {
  return (
    <div className="tw-flex tw-w-full tw-justify-center">
      <div
        data-miyo-guidance={guidance.id}
        className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-5 tw-text-center"
      >
        <div className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-sm tw-font-semibold tw-text-normal">{guidance.title}</span>
          <span className="tw-text-xs tw-leading-normal tw-text-muted">{guidance.description}</span>
        </div>
        {guidance.actions.length > 0 && (
          <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-2">
            {guidance.actions.map((action) => (
              <React.Fragment key={action.id}>
                {GUIDANCE_ACTION_RENDERERS[action.id](action, actions)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render Relevant Notes states without plugin or Obsidian runtime access.
 *
 * @param status - Current lifecycle or settled search status.
 * @param noteRows - Rendered note rows in result order.
 * @param actions - Runtime-owned destinations for presentation action IDs.
 */
export function RelevantNotesPane({
  status,
  noteRows,
  actions,
}: RelevantNotesPaneProps): React.ReactElement {
  const presentation = getRelevantNotesPresentation(
    status,
    noteRows.length > 0,
    actions.reviewIndexing.destination
  );

  if (!presentation.showPane) {
    return <></>;
  }

  const guidancePanel = presentation.guidance ? (
    <GuidancePanel guidance={presentation.guidance} actions={actions} />
  ) : null;

  if (presentation.layout === "empty") {
    return (
      <div
        data-relevant-notes-empty-state
        className="tw-flex tw-h-full tw-items-center tw-justify-center tw-px-4"
      >
        {guidancePanel ?? <span className="tw-text-sm tw-text-muted">No relevant notes found</span>}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {guidancePanel}
      {presentation.showRows && <div className="tw-flex tw-flex-col tw-gap-0.5">{noteRows}</div>}
    </div>
  );
}
