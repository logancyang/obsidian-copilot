import React from "react";
import { FileDiff, FileText } from "lucide-react";
import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import { openChangedNote } from "@/agentMode/ui/openChangedNote";
import { useApp } from "@/context";
import { openLinkClickProps } from "@/utils/openVaultPath";

export interface FilesChangedCardProps {
  changes: TurnFileChange[];
  onOpen: (change: TurnFileChange) => void;
}

export const FilesChangedCard: React.FC<FilesChangedCardProps> = ({ changes, onOpen }) => {
  const rows = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const additions = rows.reduce((sum, row) => sum + row.additions, 0);
  const deletions = rows.reduce((sum, row) => sum + row.deletions, 0);

  return (
    <div className="tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      {/* A one-file turn needs no count header above its single row: https://github.com/Brevilabs/obsidian-copilot-private/issues/348 */}
      {rows.length > 1 ? (
        <div className="copilot-divider-b tw-flex tw-items-center tw-gap-1.5 tw-px-3 tw-py-2">
          <FileDiff className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
            Files changed ({rows.length})
          </span>
          <FileChangeCounts additions={additions} deletions={deletions} />
        </div>
      ) : null}
      <ul className="tw-m-0 tw-max-h-64 tw-list-none tw-overflow-y-auto tw-p-0">
        {rows.map((row) => (
          <li key={row.path}>
            <FileRow change={row} onOpen={onOpen} />
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

const FileRow: React.FC<FileRowProps> = ({ change, onOpen }) => {
  const app = useApp();
  const separator = change.path.lastIndexOf("/");
  const basename = separator === -1 ? change.path : change.path.slice(separator + 1);
  const folder = separator === -1 ? null : change.path.slice(0, separator);

  return (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-0.5 tw-px-3 tw-py-1.5 hover:tw-bg-modifier-hover">
      <button
        type="button"
        title={change.path}
        onClick={() => onOpen(change)}
        className="tw-absolute tw-inset-0 tw-size-full tw-cursor-pointer !tw-rounded-none tw-border-none !tw-bg-transparent tw-p-0 !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
      />
      <span className="tw-pointer-events-none tw-relative tw-flex tw-w-full tw-items-center tw-gap-1.5">
        <FileText className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex tw-min-w-0 tw-flex-1 tw-text-sm">
          {/* A deleted file has no note to open, so only its diff is offered: https://github.com/Brevilabs/obsidian-copilot-private/issues/919 */}
          {change.after === null ? (
            <span className="tw-truncate">{basename}</span>
          ) : (
            <a
              href="#"
              className="tw-pointer-events-auto tw-truncate tw-text-normal hover:tw-text-accent hover:tw-underline"
              {...openLinkClickProps((pane) => openChangedNote(app, change.path, pane))}
            >
              {basename}
            </a>
          )}
        </span>
        <FileChangeStatusBadge status={change.status} />
        <FileChangeCounts additions={change.additions} deletions={change.deletions} />
      </span>
      {folder ? (
        <span className="tw-pointer-events-none tw-relative tw-w-full tw-truncate tw-pl-5 tw-text-xs tw-text-muted">
          {folder}
        </span>
      ) : null}
    </div>
  );
};
