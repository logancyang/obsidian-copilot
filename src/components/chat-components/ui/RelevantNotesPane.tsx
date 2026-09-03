import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import React from "react";

type RelevantNotesPaneStatus =
  | "idle"
  | "loading"
  | "disabled"
  | "unavailable"
  | "matches"
  | "no-matches"
  | "not-indexed";

interface RelevantNotesIndexingReviewAction {
  destination: "miyo" | "settings";
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

interface GuidancePanelProps {
  id: "download" | "unavailable" | "no-matches" | "not-indexed";
  title: string;
  description: string;
  children?: React.ReactNode;
}

function GuidancePanel({
  id,
  title,
  description,
  children,
}: GuidancePanelProps): React.ReactElement {
  return (
    <div className="tw-flex tw-w-full tw-justify-center">
      <div
        data-miyo-guidance={id}
        className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-5 tw-text-center"
      >
        <div className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-sm tw-font-semibold tw-text-normal">{title}</span>
          <span className="tw-text-xs tw-leading-normal tw-text-muted">{description}</span>
        </div>
        {children && (
          <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-2">{children}</div>
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
 * @param actions - Runtime-owned destinations for pane actions.
 */
export function RelevantNotesPane({
  status,
  noteRows,
  actions,
}: RelevantNotesPaneProps): React.ReactElement {
  // A pending request has not established an empty result or a setup failure.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (status === "loading") {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-gap-2 tw-text-sm tw-text-normal">
        <Loader2 className="tw-size-4 tw-animate-spin" />
        Finding relevant notes…
      </div>
    );
  }

  // Status decides whether link and backlink rows are trustworthy enough to
  // show and which recovery action fits the current Miyo state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  let showRows = false;
  let guidancePanel: React.ReactNode = null;
  switch (status) {
    case "disabled":
      guidancePanel = (
        <GuidancePanel
          id="download"
          title="Add semantic matches with Miyo"
          description="Download Miyo, then connect it in Copilot settings to find related notes."
        >
          <Button asChild variant="secondary" size="sm">
            <a href={actions.miyoDownloadUrl} target="_blank" rel="noopener noreferrer">
              <Download className="tw-size-3.5" />
              Download Miyo
            </a>
          </Button>
          <Button variant="default" size="sm" onClick={actions.onOpenMiyoSettings}>
            Set up in Copilot
          </Button>
        </GuidancePanel>
      );
      break;
    case "unavailable":
      guidancePanel = (
        <GuidancePanel
          id="unavailable"
          title="Miyo is not connected"
          description="Make sure Miyo is running and this vault is registered."
        >
          <Button variant="default" size="sm" onClick={actions.onOpenMiyoSettings}>
            Open Miyo settings
          </Button>
        </GuidancePanel>
      );
      break;
    case "no-matches":
      showRows = true;
      guidancePanel = (
        <GuidancePanel
          id="no-matches"
          title="No semantic matches yet"
          description="Miyo is connected, but no related notes were found."
        />
      );
      break;
    case "not-indexed": {
      showRows = true;
      const reviewInMiyo = actions.reviewIndexing.destination === "miyo";
      guidancePanel = (
        <GuidancePanel
          id="not-indexed"
          title="This note isn't indexed in Miyo"
          description={
            reviewInMiyo
              ? "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings."
              : "It may still be indexing or be excluded from Miyo. Review the configured Miyo connection or server in Copilot."
          }
        >
          <Button variant="secondary" size="sm" onClick={actions.onRefresh}>
            Refresh
          </Button>
          <Button variant="default" size="sm" onClick={actions.reviewIndexing.onSelect}>
            {reviewInMiyo ? "Open Miyo" : "Review Miyo connection"}
          </Button>
        </GuidancePanel>
      );
      break;
    }
    case "matches":
      showRows = true;
      break;
    case "idle":
      break;
  }

  if (!showRows || noteRows.length === 0) {
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
      <div className="tw-flex tw-flex-col tw-gap-0.5">{noteRows}</div>
    </div>
  );
}
