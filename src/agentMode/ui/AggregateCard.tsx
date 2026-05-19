import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { ActionCard } from "@/agentMode/ui/ActionCard";
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
  const isProcessing = parts.some((p) => p.status === "pending" || p.status === "in_progress");

  return (
    <div className="tw-my-1 tw-flex tw-flex-col tw-gap-0.5">
      <div
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-1.5 tw-text-sm tw-text-muted hover:tw-text-normal"
        onClick={() => setOpen((v) => !v)}
        role="button"
      >
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{agg.line}</span>
        {isProcessing ? (
          <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />
        ) : null}
        {open ? (
          <ChevronDown className="tw-size-3 tw-text-muted" />
        ) : (
          <ChevronRight className="tw-size-3 tw-text-muted" />
        )}
      </div>
      {open ? (
        <div className="tw-mt-1 tw-flex tw-flex-col tw-pl-3">
          {agg.outcome ? <div className="tw-text-xs tw-text-muted">{agg.outcome}</div> : null}
          {parts.map((p) => (
            <ActionCard key={p.id} part={p} inline />
          ))}
        </div>
      ) : null}
    </div>
  );
};
