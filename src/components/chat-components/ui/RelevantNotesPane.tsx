import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type {
  RelevantNotesSearchStatus,
  RelevantNotesStatusDetails,
} from "@/search/findRelevantNotes";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import React from "react";

type RelevantNotesPaneStatus = RelevantNotesSearchStatus | "idle" | "loading";

interface RelevantNotesIndexingReviewAction {
  destination: "miyo" | "settings";
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface RelevantNotesPaneActions {
  miyoDownloadUrl: string;
  onOpenMiyoSettings: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRefresh: () => void;
  onReviewContext?: () => void;
  reviewIndexing: RelevantNotesIndexingReviewAction;
}

export interface RelevantNotesPaneProps {
  status: RelevantNotesPaneStatus;
  details?: RelevantNotesStatusDetails;
  noteRows: readonly React.ReactNode[];
  actions: RelevantNotesPaneActions;
}

interface GuidancePanelProps {
  id:
    | "download"
    | "unavailable"
    | "vault-not-registered"
    | "no-matches"
    | "no-text"
    | "indexing"
    | "index-error"
    | "excluded"
    | "no-usable-context"
    | "request-too-large"
    | "request-error"
    | "not-indexed";
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
        className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-start tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-5 tw-text-left"
      >
        <div className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-sm tw-font-semibold tw-text-normal">{title}</span>
          <span className="tw-text-xs tw-leading-normal tw-text-muted">{description}</span>
        </div>
        {children && (
          <div className="tw-flex tw-flex-wrap tw-justify-start tw-gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Render Relevant Notes states without plugin or Obsidian runtime access.
 *
 * @param status - Current lifecycle or settled search status.
 * @param details - Optional Miyo error or exclusion details for the active note.
 * @param noteRows - Rendered note rows in result order.
 * @param actions - Runtime-owned destinations for pane actions.
 */
export function RelevantNotesPane({
  status,
  details,
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

  // Only a successful Miyo match can produce result rows. Other states render
  // their recovery guidance even if a stale caller supplies rows.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  let guidancePanel: React.ReactNode = null;
  switch (status) {
    // Unusable chat context must explain the failure instead of showing
    // results for an unrelated editor note.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    case "no-usable-context":
      guidancePanel = (
        <GuidancePanel
          id="no-usable-context"
          title="No usable chat context"
          description="The attachments aren't available in Miyo. Write a message or add an indexed note to find related notes."
        />
      );
      break;
    case "request-too-large":
      guidancePanel = (
        <GuidancePanel
          id="request-too-large"
          title="Chat context is too large"
          description="Miyo couldn't accept this request. Review attached context or try a shorter conversation; sent messages also contribute."
        >
          {actions.onReviewContext && (
            <Button
              variant="secondary"
              size="sm"
              className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
              onClick={actions.onReviewContext}
            >
              Review chat context
            </Button>
          )}
        </GuidancePanel>
      );
      break;
    case "request-error":
      guidancePanel = (
        <GuidancePanel
          id="request-error"
          title="Miyo couldn't use this chat context"
          description="Check that this vault is registered in Miyo, then try again."
        >
          <Button variant="default" size="sm" onClick={actions.onOpenMiyoSettings}>
            Open Miyo settings
          </Button>
        </GuidancePanel>
      );
      break;
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
    // A reachable service with no vault registration needs folder setup,
    // rather than connection troubleshooting.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/401
    case "vault-not-registered": {
      const reviewInMiyo = actions.reviewIndexing.destination === "miyo";
      const vaultLabel = details?.folderName ? `“${details.folderName}”` : "This vault";
      guidancePanel = (
        <GuidancePanel
          id="vault-not-registered"
          title="This vault isn't registered in Miyo"
          description={
            reviewInMiyo
              ? `Miyo is connected, but ${vaultLabel} isn't registered. Add this vault in Miyo to find relevant notes.`
              : `Miyo is connected, but ${vaultLabel} isn't registered. Add this vault in Miyo on the host machine.`
          }
        >
          <Button variant="secondary" size="sm" onClick={actions.reviewIndexing.onSelect}>
            {reviewInMiyo ? "Open folder settings in Miyo" : "Review Miyo connection"}
          </Button>
        </GuidancePanel>
      );
      break;
    }
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
      guidancePanel = (
        <GuidancePanel
          id="no-matches"
          title="No semantic matches yet"
          description="Miyo is connected, but no related notes were found."
        />
      );
      break;
    case "no-text":
      guidancePanel = (
        <GuidancePanel
          id="no-text"
          title="Miyo found no text in this note"
          description="The note may be empty or contain only content Miyo can't read."
        >
          <Button variant="default" size="sm" onClick={actions.onRefresh}>
            Refresh
          </Button>
        </GuidancePanel>
      );
      break;
    case "indexing":
      guidancePanel = (
        <GuidancePanel
          id="indexing"
          title="Miyo is still indexing this note"
          description="Miyo hasn't finished processing this note. Try again shortly."
        >
          <Button variant="default" size="sm" onClick={actions.onRefresh}>
            Refresh
          </Button>
        </GuidancePanel>
      );
      break;
    case "index-error": {
      const reviewInMiyo = actions.reviewIndexing.destination === "miyo";
      const errorMessage =
        details?.errorMessage?.trim() || "Miyo reported an error while processing this note.";
      guidancePanel = (
        <GuidancePanel
          id="index-error"
          title="Miyo couldn't index this note"
          description={
            reviewInMiyo
              ? errorMessage
              : `${errorMessage} Review the folder in Miyo on the host machine.`
          }
        >
          {reviewInMiyo && (
            <Button variant="default" size="sm" onClick={actions.reviewIndexing.onSelect}>
              Open Miyo
            </Button>
          )}
        </GuidancePanel>
      );
      break;
    }
    case "excluded": {
      const reviewInMiyo = actions.reviewIndexing.destination === "miyo";
      let reason: string;
      switch (details?.exclusionReason) {
        case "exclude_folder":
          reason = details.exclusionRule
            ? `Excluded by folder ${details.exclusionRule}.`
            : "Excluded by a folder filter.";
          break;
        case "exclude_pattern":
          reason = details.exclusionRule
            ? `Excluded by pattern ${details.exclusionRule}.`
            : "Excluded by a pattern filter.";
          break;
        case "include_folder":
          reason = details.exclusionRule
            ? `Not included by folder ${details.exclusionRule}.`
            : "Not included by the folder filters.";
          break;
        case "include_pattern":
          reason = details.exclusionRule
            ? `Not included by pattern ${details.exclusionRule}.`
            : "Not included by the pattern filters.";
          break;
        case "extension":
          reason = "This file type isn't included in Miyo's folder settings.";
          break;
        case "hidden":
          reason = "Miyo excludes hidden files.";
          break;
        default:
          reason = "Miyo's folder filters exclude this note.";
      }
      guidancePanel = (
        <GuidancePanel
          id="excluded"
          title="This note is excluded in Miyo"
          description={
            reviewInMiyo
              ? reason
              : `${reason} Adjust this folder's filters in Miyo on the host machine.`
          }
        >
          {reviewInMiyo && (
            <Button variant="default" size="sm" onClick={actions.reviewIndexing.onSelect}>
              Open folder settings in Miyo
            </Button>
          )}
        </GuidancePanel>
      );
      break;
    }
    case "not-indexed": {
      const reviewInMiyo = actions.reviewIndexing.destination === "miyo";
      guidancePanel = (
        <GuidancePanel
          id="not-indexed"
          title="This note isn't indexed in Miyo"
          description="It may still be indexing or be excluded from Miyo. Update Miyo to the latest version to see why."
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
    case "idle":
      break;
  }

  // Skipped sources remain visible even for an empty result.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const unnamedCount = Math.max(
    0,
    (details?.skippedAttachments ?? 0) - (details?.skippedSources?.length ?? 0)
  );
  /* eslint-disable @eslint-react/no-array-index-key -- identical attachments can occur in multiple messages; these are read-only snapshot rows */
  const notices = !!details?.skippedAttachments && (
    <Collapsible className="tw-p-2 tw-text-xs">
      <CollapsibleTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-text-left"
        >
          Skipped attachments: {details.skippedAttachments}
          <ChevronDown className="tw-size-3 tw-shrink-0" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tw-space-y-2 tw-pt-2 tw-text-muted">
        <p role="status" className="tw-m-0">
          These sources weren't used for this request.
        </p>
        <ul className="tw-m-0 tw-space-y-2 tw-pl-4">
          {details.skippedSources?.map((source, index) => (
            <li
              key={`${source.label}:${index}`}
              className="tw-select-text tw-break-words [overflow-wrap:anywhere]"
            >
              <div className="tw-font-medium tw-text-normal">
                {source.label || "Name unavailable"}
              </div>
              <div>{source.reason || "Reason not provided"}</div>
            </li>
          ))}
        </ul>
        {unnamedCount > 0 && (
          <p className="tw-m-0">
            Names are unavailable for {unnamedCount} skipped{" "}
            {unnamedCount === 1 ? "attachment" : "attachments"}.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
  /* eslint-enable @eslint-react/no-array-index-key -- resume checking outside the read-only skipped-source snapshot */

  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-gap-0.5">
      {notices}
      {status !== "matches" || noteRows.length === 0 ? (
        <div
          data-relevant-notes-empty-state
          className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-4"
        >
          {guidancePanel ?? (
            <span className="tw-text-sm tw-text-muted">No relevant notes found</span>
          )}
        </div>
      ) : (
        noteRows
      )}
    </div>
  );
}
