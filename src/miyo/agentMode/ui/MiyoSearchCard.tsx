import React from "react";
import { MiyoLogo } from "@/miyo/ui/MiyoLogo";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { cn } from "@/lib/utils";

export interface MiyoSearchCardProps {
  status: AgentToolStatus;
  query: string | null;
  noteCount: number | null;
  error?: string | null;
}

export const MiyoSearchCard: React.FC<MiyoSearchCardProps> = ({
  status,
  query,
  noteCount,
  error,
}) => {
  const running = status === "pending" || status === "in_progress";
  const failed = status === "failed";
  const label = running
    ? "Searching with Miyo"
    : failed
      ? "Miyo search failed"
      : "Searched with Miyo";
  const outcome =
    running || failed || noteCount === null
      ? null
      : noteCount === 0
        ? "No notes"
        : pluralize(noteCount, "note");

  return (
    <div
      className={cn(
        "tw-my-1 tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-rounded-md tw-border tw-border-solid tw-bg-secondary tw-px-2 tw-py-1.5 tw-text-sm",
        failed ? "tw-border-border" : "tw-border-interactive-accent/40"
      )}
    >
      <MiyoLogo className="tw-size-4 tw-text-normal" />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-baseline tw-gap-1.5 tw-overflow-hidden">
        <span
          className={cn(
            "tw-shrink-0 tw-font-medium",
            running
              ? "copilot-shimmer-text motion-reduce:tw-animate-none"
              : failed
                ? "tw-text-error"
                : "tw-text-normal"
          )}
        >
          {label}
        </span>
        {query ? <span className="tw-min-w-0 tw-truncate tw-text-muted">“{query}”</span> : null}
      </div>
      {outcome ? <span className="tw-shrink-0 tw-text-xs tw-text-muted">{outcome}</span> : null}
      {error ? (
        <div className="tw-line-clamp-2 tw-basis-full tw-pl-6 tw-text-xs tw-text-muted">
          {error}
        </div>
      ) : null}
    </div>
  );
};
