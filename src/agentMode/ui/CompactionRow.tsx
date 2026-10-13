import type { CompactionPart } from "@/agentMode/ui/agentTrail";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { AlertTriangle } from "lucide-react";
import React from "react";

interface CompactionRowProps {
  part: CompactionPart;
}

const RUNNING_LABEL = {
  manual: { text: "Compacting conversation…", announcement: "Compacting conversation" },
  auto: { text: "Context is full, compacting…", announcement: "Context is full, compacting" },
} as const;

function formatTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

function completedText(part: CompactionPart): string {
  const label = part.trigger === "auto" ? "Context compacted automatically" : "Context compacted";
  return part.preTokens !== undefined && part.postTokens !== undefined
    ? `${label} · ${formatTokens(part.preTokens)} → ${formatTokens(part.postTokens)} tokens`
    : label;
}

const Hairline: React.FC = () => (
  <span className="tw-flex-1 tw-border-0 tw-border-t tw-border-solid tw-border-border" />
);

export const CompactionRow: React.FC<CompactionRowProps> = ({ part }) => {
  switch (part.status) {
    case "in_progress": {
      const label = RUNNING_LABEL[part.trigger];
      return (
        <AgentTurnDurationIndicator
          status="running"
          startedAtMs={part.startedAtMs}
          label={label.text}
          announcement={label.announcement}
          inline
        />
      );
    }
    case "completed":
      return (
        <div className="tw-flex tw-items-center tw-gap-2 tw-py-1 tw-text-ui-small tw-text-muted">
          <Hairline />
          <span>{completedText(part)}</span>
          <Hairline />
        </div>
      );
    case "failed":
      return (
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-py-1 tw-pl-1 tw-text-ui-small tw-text-muted">
          <AlertTriangle aria-hidden="true" className="tw-size-3 tw-shrink-0 tw-text-warning" />
          <span>{part.error ? `Couldn't compact: ${part.error}` : "Couldn't compact"}</span>
        </div>
      );
    case "cancelled":
      return (
        <div className="tw-py-1 tw-pl-1 tw-text-ui-small tw-text-muted">Compaction cancelled</div>
      );
    case "skipped":
      return (
        <div className="tw-py-1 tw-pl-1 tw-text-ui-small tw-text-muted">Nothing to compact yet</div>
      );
  }
};
