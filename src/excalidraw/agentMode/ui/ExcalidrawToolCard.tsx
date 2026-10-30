import React, { useId } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import type { ExcalidrawDrawingSummary } from "@/excalidraw/agentMode/excalidrawToolRun";
import { cn } from "@/lib/utils";

export interface ExcalidrawToolCardProps extends ExcalidrawDrawingSummary {
  onOpenDrawing: (path: string) => void;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

const LABELS = {
  create: {
    running: "Drawing in Excalidraw",
    completed: "Drew in Excalidraw",
    failed: "Couldn't draw in Excalidraw",
    cancelled: "Excalidraw drawing stopped",
  },
  edit: {
    running: "Editing in Excalidraw",
    completed: "Edited in Excalidraw",
    failed: "Couldn't edit in Excalidraw",
    cancelled: "Excalidraw edit stopped",
  },
  read: {
    running: "Reading Excalidraw drawing",
    completed: "Read Excalidraw drawing",
    failed: "Couldn't read Excalidraw drawing",
    cancelled: "Excalidraw read stopped",
  },
} as const;

export const ExcalidrawToolCard: React.FC<ExcalidrawToolCardProps> = ({
  action,
  status,
  path,
  failed,
  onOpenDrawing,
  open,
  onToggle,
  children,
}) => {
  const bodyId = useId();
  const state = status === "pending" || status === "in_progress" ? "running" : status;
  const name = path?.slice(path.lastIndexOf("/") + 1).replace(/(\.excalidraw)?(\.md)?$/, "");

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col tw-gap-1 tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-bg-secondary tw-px-2 tw-py-1.5 tw-text-sm tw-border-interactive-accent/40">
      <div className="tw-flex tw-w-full tw-items-center tw-gap-2">
        <CopilotBrandIcon className="tw-size-4 tw-text-normal" />
        <span
          className={cn(
            "tw-shrink-0 tw-font-medium",
            state === "running"
              ? "copilot-shimmer-text motion-reduce:tw-animate-none"
              : "tw-text-normal"
          )}
        >
          {LABELS[action][state]}
        </span>
        {path && state === "completed" ? (
          <Button
            variant="link"
            size="fit"
            title={path}
            className="!tw-h-auto tw-min-w-0 tw-justify-start !tw-border-0 !tw-bg-transparent !tw-px-0 tw-text-sm !tw-text-accent !tw-shadow-none"
            onClick={() => onOpenDrawing(path)}
          >
            <span className="tw-truncate">{name}</span>
          </Button>
        ) : path ? (
          <span title={path} className="tw-min-w-0 tw-truncate tw-text-muted">
            {name}
          </span>
        ) : null}
        <span className="tw-flex-1" />
        {failed > 0 ? (
          <span className="tw-shrink-0 tw-text-xs tw-text-muted">{failed} failed</span>
        ) : null}
        <Button
          variant="ghost2"
          size="fit"
          aria-label={open ? "Hide Excalidraw steps" : "Show Excalidraw steps"}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <ChevronRight
            className={cn("tw-size-3 tw-shrink-0 tw-transition-transform", open && "tw-rotate-90")}
          />
        </Button>
      </div>
      {open ? (
        <div id={bodyId} className="tw-flex tw-flex-col tw-gap-1 tw-pl-6">
          {children}
        </div>
      ) : null}
    </div>
  );
};
