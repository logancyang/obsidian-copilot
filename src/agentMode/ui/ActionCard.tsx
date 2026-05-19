import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check, X } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { renderDiff } from "@/agentMode/ui/diffRender";
import { cn } from "@/lib/utils";

interface ActionCardProps {
  part: ToolCallPart;
  /** When true, render the collapsed-only inline-row variant used inside an
   *  AggregateCard's expanded list. The card has no border/bg of its own. */
  inline?: boolean;
}

export const ActionCard: React.FC<ActionCardProps> = ({ part, inline }) => {
  const [open, setOpen] = useState(false);
  const summary = lookupToolSummary(part);
  const Icon = summary.icon;
  const line = summary.collapsedLine(part);
  const outcome = summary.outcome(part);
  const outputs = part.output ?? [];
  const details = summary.expandedDetails?.(part) ?? null;
  const expandable = outputs.length > 0 || details !== null;

  const headerClasses = cn(
    "tw-flex tw-items-center tw-gap-1.5 tw-text-sm tw-text-muted",
    expandable && "tw-cursor-pointer hover:tw-text-normal"
  );

  const wrapperClasses = cn("tw-flex tw-flex-col tw-gap-0.5", inline ? "tw-py-1" : "tw-my-1");

  return (
    <div className={wrapperClasses}>
      <div
        className={headerClasses}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        role={expandable ? "button" : undefined}
      >
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{line}</span>
        <StatusBadge status={part.status} />
        {expandable &&
          (open ? (
            <ChevronDown className="tw-size-3 tw-text-muted" />
          ) : (
            <ChevronRight className="tw-size-3 tw-text-muted" />
          ))}
      </div>
      {expandable && open ? (
        <div className="tw-mt-1 tw-flex tw-flex-col tw-gap-1">
          {details ? (
            <pre className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs">
              {details}
            </pre>
          ) : null}
          {outcome ? <div className="tw-text-xs tw-text-muted">{outcome}</div> : null}
          {outputs.map((o, i) =>
            o.type === "text" ? (
              <pre
                // eslint-disable-next-line @eslint-react/no-array-index-key -- tool outputs are append-only; index is stable
                key={`text-${i}`}
                className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs"
              >
                {o.text}
              </pre>
            ) : (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- tool outputs are append-only; index is stable
              <div key={`diff-${i}-${o.path}`} className="tw-rounded tw-bg-secondary-alt tw-p-1">
                <p className="tw-font-mono tw-text-xs tw-text-muted">{o.path}</p>
                <pre className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-text-xs">
                  {renderDiff(o.oldText, o.newText)}
                </pre>
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  );
};

interface StatusBadgeProps {
  status: AgentToolStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  if (status === "in_progress" || status === "pending") {
    return <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />;
  }
  if (status === "failed") {
    return <X className="tw-size-3 tw-shrink-0 tw-text-error" />;
  }
  return <Check className="tw-size-3 tw-shrink-0 tw-text-success" />;
};
