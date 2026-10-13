import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import { Button } from "@/components/ui/button";
import React from "react";

export interface TurnDiffHeaderProps {
  path: string;
  status: TurnFileChange["status"];
  additions: number;
  deletions: number;
  onOpenNote?: () => void;
}

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
      <FileChangeStatusBadge status={status} />
      <FileChangeCounts additions={additions} deletions={deletions} />
      {onOpenNote ? (
        <Button
          variant="link"
          size="sm"
          className="tw-ml-2 !tw-h-auto tw-shrink-0 !tw-border-0 !tw-bg-transparent !tw-px-0 !tw-text-accent !tw-shadow-none"
          onClick={onOpenNote}
        >
          Open note
        </Button>
      ) : null}
    </div>
  </div>
);
