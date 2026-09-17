import React from "react";
import { cn } from "@/lib/utils";
import type { TurnFileChange } from "@/agentMode/session/types";

/**
 * U+2212 MINUS SIGN. The ASCII hyphen is narrower than the plus sign even in a
 * tabular font, so it would knock the two count columns out of alignment.
 */
const MINUS_SIGN = "−";

export interface FileChangeCountsProps {
  additions: number;
  deletions: number;
}

/**
 * The added/removed line counts of one file change, in the one presentation
 * every surface that reports a turn's changes shares, so the numbers line up
 * with each other wherever the user meets them.
 */
export const FileChangeCounts: React.FC<FileChangeCountsProps> = ({ additions, deletions }) => (
  <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-text-xs tw-tabular-nums">
    {/* A `ch` floor keeps both columns aligned down a list of rows without
        pinning a pixel width to one font size; longer counts push the column
        out together. */}
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

/**
 * Names the two lifecycle states the counts alone cannot tell apart: a created
 * file and a file emptied to nothing both read as a one-sided count. The badge
 * stays neutral so the green and red counts keep carrying the color.
 */
export const FileChangeStatusBadge: React.FC<FileChangeStatusBadgeProps> = ({ status }) => {
  if (status === "modified") return null;
  return (
    <span className="tw-shrink-0 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-1 tw-text-xs tw-text-muted">
      {status === "created" ? "new" : "deleted"}
    </span>
  );
};
