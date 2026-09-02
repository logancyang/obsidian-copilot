import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import React from "react";

export type RelevantNotesGuidance = "download" | "setup" | null;

export interface RelevantNotesPaneProps {
  guidance: RelevantNotesGuidance;
  isPending: boolean;
  noteCount: number;
  noteRows: React.ReactNode;
  miyoDownloadUrl: string;
  onOpenMiyoSettings: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/** Render the result, empty, and Miyo-help states without plugin or Obsidian runtime access. */
export function RelevantNotesPane({
  guidance,
  isPending,
  noteCount,
  noteRows,
  miyoDownloadUrl,
  onOpenMiyoSettings,
}: RelevantNotesPaneProps): React.ReactElement {
  // A pending request has not established either an empty result or a setup
  // failure, so keep its status neutral until the request settles.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  if (isPending) {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-gap-2 tw-text-sm tw-text-normal">
        <Loader2 className="tw-size-4 tw-animate-spin" />
        Finding relevant notes…
      </div>
    );
  }

  const isDownload = guidance === "download";
  const guidancePanel = guidance ? (
    <div
      data-miyo-guidance={guidance}
      className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-5 tw-text-center"
    >
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-sm tw-font-semibold tw-text-normal">
          {isDownload ? "Add semantic matches with Miyo" : "Check your Miyo setup"}
        </span>
        <span className="tw-text-xs tw-leading-normal tw-text-muted">
          {isDownload
            ? "Download Miyo, then connect it in Copilot settings to find related notes."
            : "Check your connection and make sure this vault is registered and indexed."}
        </span>
      </div>
      <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-2">
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
    </div>
  ) : null;

  if (noteCount === 0) {
    return (
      <div
        data-relevant-notes-empty-state
        className="tw-flex tw-h-full tw-items-center tw-justify-center tw-px-4"
      >
        {guidancePanel ?? <span className="tw-text-sm tw-text-muted">No relevant notes found</span>}
      </div>
    );
  }

  return <div className="tw-flex tw-flex-col tw-gap-0.5">{noteRows}</div>;
}
