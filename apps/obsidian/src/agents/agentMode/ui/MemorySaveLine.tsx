import { ToolCard, ToolCardRowButton, toolCardRowClass } from "@/agentMode/ui/ToolCard";
import { cn } from "@/lib/utils";
import { AlertTriangle, Brain } from "lucide-react";
import React, { useState } from "react";

export interface MemorySaveLineProps {
  agentName: string;
  memoryPath: string;
  rule: string;
  replaced?: string;
  contradicts?: string;
  onOpen: () => void;
  onOpenInstruction: () => void;
  defaultOpen?: boolean;
}

export const MemorySaveLine: React.FC<MemorySaveLineProps> = ({
  agentName,
  memoryPath,
  rule,
  replaced,
  contradicts,
  onOpen,
  onOpenInstruction,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const folderEnd = memoryPath.lastIndexOf("/");
  return (
    <ToolCard
      icon={Brain}
      label={replaced === undefined ? `${agentName} remembered` : `${agentName} replaced a rule`}
      quote={rule}
      open={open}
      onToggle={() => setOpen((wasOpen) => !wasOpen)}
      notice={
        contradicts === undefined ? null : (
          <div className="tw-flex tw-items-start tw-gap-2 tw-break-words tw-px-2 tw-pb-1.5 tw-text-xs tw-text-warning">
            <AlertTriangle aria-hidden="true" className="tw-size-4 tw-shrink-0" />
            <span>
              Goes against what {agentName} handles: “{contradicts}” This rule wins for now.{" "}
              <a
                href="#"
                className="tw-text-muted tw-underline tw-underline-offset-2 hover:tw-text-normal"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenInstruction();
                }}
              >
                Open instruction
              </a>
            </span>
          </div>
        )
      }
    >
      {replaced === undefined ? null : (
        <div className={cn(toolCardRowClass, "tw-break-words tw-text-faint tw-line-through")}>
          {replaced}
        </div>
      )}
      <div className={cn(toolCardRowClass, "tw-break-words tw-text-normal")}>{rule}</div>
      <ToolCardRowButton title={memoryPath} aria-label={`Open ${memoryPath}`} onClick={onOpen}>
        <span>{memoryPath.slice(folderEnd + 1).replace(/\.md$/, "")}</span>
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted">
          {memoryPath.slice(0, folderEnd)}
        </span>
      </ToolCardRowButton>
    </ToolCard>
  );
};
