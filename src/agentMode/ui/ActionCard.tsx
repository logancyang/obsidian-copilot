import React, { useMemo } from "react";
import { Loader2, Check, X } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { displayTargetFromPath, lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { renderDiff } from "@/agentMode/ui/diffRender";
import { getVaultBase } from "@/utils/vaultPath";
import { openVaultPath } from "@/utils/openVaultPath";
import { useApp } from "@/context";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

interface ActionCardProps {
  part: ToolCallPart;
  open: boolean;
  onToggle: () => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({ part, open, onToggle }) => {
  const app = useApp();
  const summary = lookupToolSummary(part);
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const Icon = summary.icon;
  const line = summary.collapsedLine(part, summaryCtx);
  const outcome = summary.outcome(part);
  const outputs = part.output ?? [];
  const details = summary.expandedDetails?.(part) ?? null;
  const expandable = outputs.length > 0 || details !== null;
  const targetPath =
    part.status === "completed" ? (summary.targetPath?.(part, summaryCtx) ?? null) : null;
  const link = targetPath
    ? { path: targetPath, label: displayTargetFromPath(part, summaryCtx.vaultBase) ?? targetPath }
    : null;

  return (
    <AgentActivityCard
      icon={Icon}
      label={
        link ? (
          <>
            <span className="tw-shrink-0">
              {line.slice(0, line.lastIndexOf(link.label)).trimEnd()}
            </span>
            <a
              href="#"
              className="tw-min-w-0 tw-truncate tw-text-normal hover:tw-text-accent hover:tw-underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openVaultPath(app, link.path, { newLeaf: true });
              }}
            >
              {link.label}
            </a>
          </>
        ) : (
          <span className="tw-truncate">{line}</span>
        )
      }
      trailing={<StatusBadge status={part.status} />}
      expandable={expandable}
      open={open}
      onToggle={onToggle}
    >
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
    </AgentActivityCard>
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
