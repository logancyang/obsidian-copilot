import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { ActionCard, StatusBadge } from "@/agentMode/ui/ActionCard";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";

interface AggregateCardProps {
  parts: ToolCallPart[];
}

export const AggregateCard: React.FC<AggregateCardProps> = ({ parts }) => {
  const [open, setOpen] = useState(false);
  // All peers share the same toolKey, so the first part's summary applies.
  const summary = lookupToolSummary(parts[0]);
  const agg = summary.aggregate(parts);
  const Icon = summary.icon;
  const status = aggregateStatus(parts);

  return (
    <div
      className={`tw-my-1 tw-rounded tw-border tw-border-border tw-px-2 tw-py-1.5 ${
        status === "failed" ? "tw-bg-error" : "tw-bg-secondary"
      }`}
    >
      <div
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-sm"
        onClick={() => setOpen((v) => !v)}
        role="button"
      >
        <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{agg.line}</span>
        <StatusBadge status={status} />
        {open ? (
          <ChevronDown className="tw-size-3 tw-text-muted" />
        ) : (
          <ChevronRight className="tw-size-3 tw-text-muted" />
        )}
      </div>
      {agg.outcome ? <div className="tw-pl-6 tw-text-xs tw-text-muted">{agg.outcome}</div> : null}
      {open ? (
        <div className="tw-mt-1 tw-flex tw-flex-col tw-pl-6">
          {parts.map((p) => (
            <ActionCard key={p.id} part={p} inline />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Roll up peer statuses into one badge: any pending → pending; any failed
 * (and no pending) → failed; otherwise completed.
 */
function aggregateStatus(parts: ToolCallPart[]): AgentToolStatus {
  let hasPending = false;
  let hasFailed = false;
  for (const p of parts) {
    if (p.status === "pending" || p.status === "in_progress") hasPending = true;
    else if (p.status === "failed") hasFailed = true;
  }
  if (hasPending) return "in_progress";
  if (hasFailed) return "failed";
  return "completed";
}
