import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import { Button } from "@/components/ui/button";
import React from "react";

export interface TurnDiffHeaderProps {
  /** Full vault-relative path of the file the diff below describes. */
  path: string;
  status: TurnFileChange["status"];
  additions: number;
  deletions: number;
  /** Opens the note itself; omitted for a file the turn deleted, which has none left to open. */
  onOpenNote?: () => void;
}

/**
 * Names the file a diff tab is showing and how much of it moved. It reports the
 * change only — the body below is what is being reviewed — and the one action it
 * offers leaves the diff for the live note.
 */
export const TurnDiffHeader: React.FC<TurnDiffHeaderProps> = ({
  path,
  status,
  additions,
  deletions,
  onOpenNote,
}) => (
  <div className="copilot-divider-b tw-px-[var(--file-margins)] tw-py-2">
    <div className="tw-mx-auto tw-flex tw-max-w-[var(--file-line-width)] tw-items-center tw-gap-2">
      <span title={path} className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-text-muted">
        {path}
      </span>
      {/* Badge then counts, the order the card's rows use, so the same file
          reads the same way on both surfaces. */}
      <FileChangeStatusBadge status={status} />
      <FileChangeCounts additions={additions} deletions={deletions} />
      {onOpenNote ? (
        <Button
          variant="link"
          size="sm"
          // The wide left margin keeps the action off the counts, which would
          // otherwise read as a third number in the same group. Preflight is off
          // and Obsidian's theme-scoped `button` rules outrank plain utilities,
          // so the fill, the border, the chrome and the text color all need `!`
          // for this to read as a link.
          className="tw-ml-2 !tw-h-auto tw-shrink-0 !tw-border-0 !tw-bg-transparent !tw-px-0 !tw-text-accent !tw-shadow-none"
          onClick={onOpenNote}
        >
          Open note
        </Button>
      ) : null}
    </div>
  </div>
);
