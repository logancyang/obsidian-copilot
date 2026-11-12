import type { AgentMemoryNoticeKind } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookOpen, NotebookPen } from "lucide-react";
import React from "react";

export interface AgentMemoryNoticeLineProps {
  kind: AgentMemoryNoticeKind;
  agentName: string;
  onOpen: () => void;
  className?: string;
}

export const AgentMemoryNoticeLine: React.FC<AgentMemoryNoticeLineProps> = ({
  kind,
  agentName,
  onOpen,
  className,
}) => {
  const Icon = kind === "consolidation" ? BookOpen : NotebookPen;
  const what = kind === "consolidation" ? "consolidated their memory" : "added to today's notes";
  return (
    <div className={cn("tw-w-full tw-px-3 tw-pb-2 tw-pt-1", className)}>
      <div className="tw-flex tw-items-center tw-gap-1.5 tw-pl-1 tw-text-ui-small tw-text-muted">
        <Icon className="tw-size-icon-xs tw-shrink-0" aria-hidden="true" />
        <span className="tw-min-w-0 tw-truncate">
          {agentName} {what}
        </span>
        <Button
          variant="ghost2"
          size="fit"
          onClick={onOpen}
          className="tw-text-ui-small tw-text-muted tw-underline hover:tw-text-normal"
        >
          Open
        </Button>
      </div>
    </div>
  );
};

AgentMemoryNoticeLine.displayName = "AgentMemoryNoticeLine";
