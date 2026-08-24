import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import React from "react";

export type RelevantNotesGuidance =
  | "download"
  | "unavailable"
  | "no-matches"
  | "not-indexed"
  | null;

export interface RelevantNotesPaneProps {
  guidance: RelevantNotesGuidance;
  noteCount: number;
  noteRows: React.ReactNode;
  miyoDownloadUrl: string;
  canOpenMiyoApp: boolean;
  onOpenMiyoApp: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenMiyoSettings: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/** Render the result, empty, and Miyo-help states without plugin or Obsidian runtime access. */
export function RelevantNotesPane({
  guidance,
  noteCount,
  noteRows,
  miyoDownloadUrl,
  canOpenMiyoApp,
  onOpenMiyoApp,
  onOpenMiyoSettings,
}: RelevantNotesPaneProps): React.ReactElement {
  const isDownload = guidance === "download";
  const isNoMatches = guidance === "no-matches";
  const isNotIndexed = guidance === "not-indexed";
  const isInformational = isNoMatches || isNotIndexed;
  // A links-only result set must keep its rows beneath the same state card as
  // an empty semantic result. Otherwise backlinks hide Miyo's status.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const guidancePanel = guidance ? (
    <div
      data-miyo-guidance={guidance}
      className="tw-flex tw-w-full tw-flex-col tw-items-start tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-4"
    >
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-sm tw-font-semibold tw-text-normal">
          {isDownload
            ? "Add semantic matches with Miyo"
            : isNoMatches
              ? "No semantic matches yet"
              : isNotIndexed
                ? "This note isn't indexed in Miyo"
                : "Check your Miyo setup"}
        </span>
        <span className="tw-text-xs tw-leading-normal tw-text-muted">
          {isDownload
            ? "Download Miyo, then connect it in Copilot settings. Links and backlinks still work without it."
            : isNoMatches
              ? "Miyo is connected, but no related notes were found."
              : isNotIndexed
                ? canOpenMiyoApp
                  ? "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings."
                  : "It may still be indexing or be excluded from Miyo. Review the configured Miyo connection or server in Copilot."
                : "Check your connection and make sure this vault is registered and indexed."}
        </span>
      </div>
      {!isInformational && (
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          {isDownload && (
            <Button asChild variant="secondary" size="sm">
              <a href={miyoDownloadUrl} target="_blank" rel="noopener noreferrer">
                <Download className="tw-size-3.5" />
                Download Miyo
              </a>
            </Button>
          )}
          <Button variant="default" size="sm" onClick={onOpenMiyoSettings}>
            {isDownload ? "Set up in Copilot" : "Open Miyo settings"}
          </Button>
        </div>
      )}
      {/* An unindexed source needs a configuration handoff, not install or
          setup language. The container selects the runtime-safe destination.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/280 */}
      {isNotIndexed && (
        <Button
          variant="default"
          size="sm"
          onClick={canOpenMiyoApp ? onOpenMiyoApp : onOpenMiyoSettings}
        >
          {canOpenMiyoApp ? "Open Miyo" : "Review Miyo connection"}
        </Button>
      )}
    </div>
  ) : null;

  if (noteCount === 0) {
    return (
      <div
        data-relevant-notes-empty-state
        className="tw-flex tw-h-full tw-items-center tw-justify-center"
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
