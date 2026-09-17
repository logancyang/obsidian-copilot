import React, { useMemo } from "react";
import { FileDiff, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";

export interface FilesChangedCardProps {
  /** Every file the turn changed, in any order; the card sorts them by path. */
  changes: TurnFileChange[];
  /** Opens one file's before/after diff. */
  onOpen: (change: TurnFileChange) => void;
}

/**
 * Closes an agent turn with the set of notes it changed, so the user can see the
 * blast radius of a turn without re-reading its tool calls. It reports only what
 * the turn captured; opening a file's diff is the caller's decision.
 */
export const FilesChangedCard: React.FC<FilesChangedCardProps> = ({ changes, onOpen }) => {
  const rows = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          additions: sum.additions + row.additions,
          deletions: sum.deletions + row.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [rows]
  );

  return (
    <div className="tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary-alt">
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-1.5 tw-px-3 tw-py-2">
        <FileDiff className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
          Files changed ({rows.length})
        </span>
        <FileChangeCounts additions={totals.additions} deletions={totals.deletions} />
      </div>
      {/* 16rem — five rows' worth of height, counting the folder line most rows
          carry. A turn that changed more files must not push the composer off
          screen, so the rows scroll inside the card instead. */}
      <ul className="tw-m-0 tw-max-h-64 tw-list-none tw-overflow-y-auto tw-p-0">
        {rows.map((row) => (
          <FileRow key={row.path} change={row} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
};

interface FileRowProps {
  change: TurnFileChange;
  onOpen: (change: TurnFileChange) => void;
}

const FileRow: React.FC<FileRowProps> = ({ change, onOpen }) => {
  const separator = change.path.lastIndexOf("/");
  const basename = separator === -1 ? change.path : change.path.slice(separator + 1);
  const folder = separator === -1 ? null : change.path.slice(0, separator);

  return (
    <li>
      {/* Preflight is off and Obsidian's own `button` rules are theme-scoped, so
          they outrank plain utilities: the fill, the fixed height that would
          crush the folder line, and the chrome all need `!` to come back off. */}
      <button
        type="button"
        title={change.path}
        onClick={() => onOpen(change)}
        className={cn(
          "tw-flex !tw-h-auto tw-w-full tw-cursor-pointer tw-flex-col tw-gap-0.5 !tw-rounded-none !tw-border-0 !tw-bg-transparent tw-px-3 tw-py-1.5 tw-text-left tw-text-normal !tw-shadow-none",
          "hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
        )}
      >
        <span className="tw-flex tw-w-full tw-items-center tw-gap-1.5">
          <FileText className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm">{basename}</span>
          <FileChangeStatusBadge status={change.status} />
          <FileChangeCounts additions={change.additions} deletions={change.deletions} />
        </span>
        {/* Indented past the file icon (icon 14px + gap 6px) so the folder hangs
            under the basename rather than under the icon. */}
        {folder ? (
          <span className="tw-w-full tw-truncate tw-pl-5 tw-text-xs tw-text-muted">{folder}</span>
        ) : null}
      </button>
    </li>
  );
};
