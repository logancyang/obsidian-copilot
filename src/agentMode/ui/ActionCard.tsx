import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check, X } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { renderDiff } from "@/agentMode/ui/diffRender";
import { deriveEditDiff, diffStats } from "@/agentMode/ui/editDiff";
import { openAgentDiffView } from "@/agentMode/ui/AgentDiffView";
import { getVaultBase } from "@/utils/vaultPath";
import { openVaultPath } from "@/utils/openVaultPath";
import { cn } from "@/lib/utils";
import { useApp } from "@/context";

interface ActionCardProps {
  part: ToolCallPart;
  /** When true, render the collapsed-only inline-row variant used inside an
   *  AggregateCard's expanded list. The card has no border/bg of its own. */
  inline?: boolean;
}

export const ActionCard: React.FC<ActionCardProps> = ({ part, inline }) => {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const summary = lookupToolSummary(part);
  // `vaultBase` is stable for the plugin lifetime, but `getVaultBase` is
  // cheap once cached — memoize to keep the summary inputs referentially
  // stable across re-renders.
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const Icon = summary.icon;
  const line = summary.collapsedLine(part, summaryCtx);
  const outcome = summary.outcome(part);
  const outputs = part.output ?? [];
  const details = summary.expandedDetails?.(part) ?? null;

  // A completed edit whose before/after we can resolve gets the pane treatment:
  // an inline +/− chip and a whole-row click that opens the diff view. Non-edit
  // tools yield null here, so they keep the classic expand/file-open behavior.
  const editDiff =
    part.status === "completed" ? deriveEditDiff(part, summaryCtx) : null;
  const isEditWithDiff = editDiff !== null;
  const stats = editDiff ? diffStats(editDiff) : null;

  // An edit-with-diff row is pane-only: the whole row opens the diff view and
  // there is no chevron. Making it also expandable would render a chevron whose
  // click bubbles to the row's pane-open handler (the chevron has no handler of
  // its own), so the toggle could never fire — a dead affordance. Suppressing
  // expandability keeps one unambiguous interaction per row and, like the
  // inline `{type:"diff"}` pre, drops the redundant edit result text (e.g. "The
  // file … has been updated"), which the +/− chip and the pane already convey.
  const expandable = !isEditWithDiff && (outputs.length > 0 || details !== null);
  // Only expose a clickable target once the call has completed — opening a
  // half-written file mid-Edit would race with the tool, and an in-progress
  // Read has nothing to show yet. Edits route through the diff pane instead of
  // opening the file, so they don't use `targetPath`.
  const targetPath =
    part.status === "completed" && !isEditWithDiff
      ? (summary.targetPath?.(part, summaryCtx) ?? null)
      : null;

  const openDiff = editDiff
    ? () => openAgentDiffView(app, editDiff)
    : undefined;
  const rowInteractive = isEditWithDiff || expandable;

  const headerClasses = cn(
    "tw-flex tw-items-center tw-gap-1.5 tw-text-sm tw-text-muted",
    rowInteractive && "tw-cursor-pointer hover:tw-text-normal"
  );

  const wrapperClasses = cn("tw-flex tw-flex-col tw-gap-0.5", inline ? "tw-py-1" : "tw-my-1");

  return (
    <div className={wrapperClasses}>
      <div
        className={headerClasses}
        onClick={openDiff ?? (expandable ? () => setOpen((v) => !v) : undefined)}
        role={rowInteractive ? "button" : undefined}
        tabIndex={isEditWithDiff ? 0 : undefined}
        onKeyDown={
          openDiff
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDiff();
                }
              }
            : undefined
        }
      >
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        {targetPath ? (
          <a
            href="#"
            className="tw-flex-1 tw-truncate tw-font-medium tw-text-inherit hover:tw-text-accent hover:tw-underline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // `targetPath` is vault-relative for in-vault notes but stays
              // absolute for files the agent read/wrote outside the vault.
              // Route through `openVaultPath` so an outside-vault path opens
              // in the OS app instead of fabricating a phantom vault folder.
              openVaultPath(app, targetPath, { newLeaf: true });
            }}
          >
            {line}
          </a>
        ) : (
          <span className="tw-flex-1 tw-truncate tw-font-medium">{line}</span>
        )}
        {stats ? (
          <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-tabular-nums">
            {stats.added > 0 ? <span className="tw-text-success">+{stats.added}</span> : null}
            {stats.removed > 0 ? <span className="tw-text-error">−{stats.removed}</span> : null}
          </span>
        ) : null}
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
