import React, { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check, X, CircleSlash } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { renderDiff } from "@/agentMode/ui/diffRender";

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
  const isEmpty = part.status === "completed" && outputs.length === 0;
  const expandable = !inline && outputs.length > 0;

  const headerClasses = inline
    ? "tw-flex tw-items-center tw-gap-2 tw-text-sm"
    : "tw-flex tw-items-center tw-gap-2 tw-text-sm tw-cursor-pointer";

  const wrapperClasses = inline
    ? "tw-flex tw-flex-col tw-gap-0.5 tw-py-1"
    : `tw-my-1 tw-rounded tw-border tw-border-border tw-px-2 tw-py-1.5 ${cardBg(part.status)}`;

  return (
    <div className={wrapperClasses}>
      <div
        className={headerClasses}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        role={expandable ? "button" : undefined}
      >
        <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{line}</span>
        <StatusBadge status={part.status} empty={isEmpty} />
        {expandable &&
          (open ? (
            <ChevronDown className="tw-size-3 tw-text-muted" />
          ) : (
            <ChevronRight className="tw-size-3 tw-text-muted" />
          ))}
      </div>
      {outcome ? <div className="tw-pl-6 tw-text-xs tw-text-muted">{outcome}</div> : null}
      {expandable && open ? (
        <div className="tw-mt-1 tw-flex tw-flex-col tw-gap-1 tw-pl-6">
          {outputs.map((o, i) =>
            o.type === "text" ? (
              <pre
                key={i}
                className="tw-max-h-40 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs"
              >
                {o.text}
              </pre>
            ) : (
              <div key={i} className="tw-rounded tw-bg-secondary-alt tw-p-1">
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
  empty?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, empty }) => {
  if (status === "in_progress" || status === "pending") {
    return <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />;
  }
  if (status === "failed") {
    return <X className="tw-size-3 tw-shrink-0 tw-text-error" />;
  }
  if (empty) {
    return <CircleSlash className="tw-size-3 tw-shrink-0 tw-text-muted" />;
  }
  return <Check className="tw-size-3 tw-shrink-0 tw-text-success" />;
};

function cardBg(status: AgentToolStatus): string {
  switch (status) {
    case "completed":
      return "tw-bg-secondary";
    case "failed":
      return "tw-bg-error";
    default:
      return "tw-bg-secondary";
  }
}
