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
  if (rows.length === 1) {
    return <SingleFileCard change={rows[0]} onOpen={onOpen} />;
  }
  return <FileListCard rows={rows} onOpen={onOpen} />;
};

const CARD_CHROME =
  "tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary";

/**
 * The commonest turn changes one note, and a header counting "(1)" over a
 * single row reads like a list of two. The card collapses to that one file:
 * the diff icon and the name take the header's place, the counts stay where
 * they always are, and the whole card is the click target.
 */
const SingleFileCard: React.FC<FileRowProps> = ({ change, onOpen }) => (
  <div className={CARD_CHROME}>
    <FileRow change={change} onOpen={onOpen} variant="single" />
  </div>
);

interface FileListCardProps {
  rows: TurnFileChange[];
  onOpen: (change: TurnFileChange) => void;
}

const FileListCard: React.FC<FileListCardProps> = ({ rows, onOpen }) => {
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
    <div className={CARD_CHROME}>
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
          <li key={row.path}>
            <FileRow change={row} onOpen={onOpen} variant="list" />
          </li>
        ))}
      </ul>
    </div>
  );
};

interface FileRowProps {
  change: TurnFileChange;
  onOpen: (change: TurnFileChange) => void;
}

interface FileRowVariantProps extends FileRowProps {
  /**
   * `list` is one row under the "Files changed" header; `single` is the whole
   * card, so it takes the header's icon, weight and padding.
   */
  variant: "list" | "single";
}

const FileRow: React.FC<FileRowVariantProps> = ({ change, onOpen, variant }) => {
  const separator = change.path.lastIndexOf("/");
  const basename = separator === -1 ? change.path : change.path.slice(separator + 1);
  const folder = separator === -1 ? null : change.path.slice(0, separator);
  const single = variant === "single";
  const Icon = single ? FileDiff : FileText;

  // Preflight is off and Obsidian's own `button` rules are theme-scoped, so
  // they outrank plain utilities: the fill, the fixed height that would
  // crush the folder line, and the chrome all need `!` to come back off.
  return (
    <button
      type="button"
      title={change.path}
      onClick={() => onOpen(change)}
      className={cn(
        "tw-flex !tw-h-auto tw-w-full tw-cursor-pointer tw-flex-col tw-gap-0.5 !tw-rounded-none !tw-border-0 !tw-bg-transparent tw-px-3 tw-text-left tw-text-normal !tw-shadow-none",
        single ? "tw-py-2" : "tw-py-1.5",
        "hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
      )}
    >
      <span className="tw-flex tw-w-full tw-items-center tw-gap-1.5">
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span
          className={cn("tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm", single && "tw-font-medium")}
        >
          {basename}
        </span>
        <FileChangeStatusBadge status={change.status} />
        <FileChangeCounts additions={change.additions} deletions={change.deletions} />
      </span>
      {/* Indented past the file icon (icon 14px + gap 6px) so the folder hangs
            under the basename rather than under the icon. */}
      {folder ? (
        <span className="tw-w-full tw-truncate tw-pl-5 tw-text-xs tw-text-muted">{folder}</span>
      ) : null}
    </button>
  );
};
