import React from "react";
import { Button } from "@/components/ui/button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import type { ExcalidrawToolRun } from "@/excalidraw/agentMode/excalidrawToolRun";
import { cn } from "@/lib/utils";

export interface ExcalidrawToolCardProps extends ExcalidrawToolRun {
  onOpenDrawing: (path: string) => void;
}

const LABELS = {
  create: {
    running: "Drawing in Excalidraw",
    completed: "Drew in Excalidraw",
    cancelled: "Excalidraw drawing stopped",
  },
  edit: {
    running: "Editing in Excalidraw",
    completed: "Edited in Excalidraw",
    cancelled: "Excalidraw edit stopped",
  },
  read: {
    running: "Reading Excalidraw drawing",
    completed: "Read Excalidraw drawing",
    cancelled: "Excalidraw read stopped",
  },
} as const;

export const ExcalidrawToolCard: React.FC<ExcalidrawToolCardProps> = ({
  action,
  status,
  path,
  onOpenDrawing,
}) => {
  const state = status === "pending" || status === "in_progress" ? "running" : status;
  const name = path?.slice(path.lastIndexOf("/") + 1).replace(/(\.excalidraw)?(\.md)?$/, "");

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-items-center tw-gap-2 tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-bg-secondary tw-px-2 tw-py-1.5 tw-text-sm tw-border-interactive-accent/40">
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
    </div>
  );
};
