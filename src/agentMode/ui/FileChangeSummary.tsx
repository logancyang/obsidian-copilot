import React from "react";
import { cn } from "@/lib/utils";
import type { TurnFileChange } from "@/agentMode/session/types";

const MINUS_SIGN = "−";

export interface FileChangeCountsProps {
  additions: number;
  deletions: number;
}

export const FileChangeCounts: React.FC<FileChangeCountsProps> = ({ additions, deletions }) => (
  <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-text-xs tw-tabular-nums">
    <span
      className={cn(
        "tw-min-w-[4ch] tw-text-right",
        additions > 0 ? "tw-text-success" : "tw-text-muted"
      )}
    >
      +{additions}
    </span>
    <span
      className={cn(
        "tw-min-w-[4ch] tw-text-right",
        deletions > 0 ? "tw-text-error" : "tw-text-muted"
      )}
    >
      {MINUS_SIGN}
      {deletions}
    </span>
  </span>
);

export interface FileChangeStatusBadgeProps {
  status: TurnFileChange["status"];
}

export const FileChangeStatusBadge: React.FC<FileChangeStatusBadgeProps> = ({ status }) => {
  if (status === "modified") return null;
  return (
    <span className="tw-shrink-0 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-px-1 tw-text-xs tw-text-muted">
      {status === "created" ? "new" : "deleted"}
    </span>
  );
};
