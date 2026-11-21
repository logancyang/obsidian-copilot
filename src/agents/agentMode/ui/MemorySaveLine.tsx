import { cn } from "@/lib/utils";
import { AlertTriangle, Brain } from "lucide-react";
import React from "react";

export interface MemorySaveLineProps {
  agentName: string;
  memoryPath: string;
  rule: string;
  replaced?: string;
  contradicts?: string;
  onOpen: () => void;
  onOpenInstruction: () => void;
}

export const MemorySaveLine: React.FC<MemorySaveLineProps> = ({
  agentName,
  memoryPath,
  rule,
  replaced,
  contradicts,
  onOpen,
  onOpenInstruction,
}) => (
  <div className="tw-group/memory tw-relative tw-my-1 tw-flex tw-flex-wrap tw-items-start tw-gap-x-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-modifier-hover tw-px-2.5 tw-py-1.5 tw-text-sm tw-text-muted hover:tw-bg-modifier-active-hover">
    <button
      type="button"
      title={memoryPath}
      aria-label={`Open ${memoryPath}`}
      onClick={onOpen}
      className="tw-absolute tw-inset-0 tw-size-full tw-cursor-pointer !tw-rounded-md tw-border-none !tw-bg-transparent tw-p-0 !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
    />
    <Brain aria-hidden="true" className="tw-mt-0.5 tw-size-3.5 tw-shrink-0" />
    <div className="tw-pointer-events-none tw-relative tw-min-w-0 tw-flex-1 tw-break-words">
      <div className="tw-font-medium tw-text-normal">
        {replaced === undefined ? `${agentName} remembered` : `${agentName} replaced a rule`}
      </div>
      {replaced === undefined ? null : (
        <div className="tw-text-faint tw-line-through">{replaced}</div>
      )}
      <div className="tw-text-normal">“{rule}”</div>
    </div>
    <span
      aria-hidden="true"
      className={cn(
        "tw-pointer-events-none tw-relative tw-shrink-0 tw-text-xs tw-text-muted",
        "group-hover/memory:tw-text-normal"
      )}
    >
      Open
    </span>
    {contradicts === undefined ? null : (
      <div className="tw-pointer-events-none tw-relative tw-mt-1.5 tw-flex tw-basis-full tw-items-start tw-gap-2 tw-break-words tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-1.5 tw-text-warning">
        <AlertTriangle aria-hidden="true" className="tw-mt-0.5 tw-size-3.5 tw-shrink-0" />
        <span>
          Goes against what {agentName} handles: “{contradicts}” This rule wins for now.{" "}
          <a
            href="#"
            className="tw-pointer-events-auto tw-text-muted tw-underline tw-underline-offset-2 hover:tw-text-normal"
            onClick={(event) => {
              event.preventDefault();
              onOpenInstruction();
            }}
          >
            Open instruction
          </a>
        </span>
      </div>
    )}
  </div>
);
