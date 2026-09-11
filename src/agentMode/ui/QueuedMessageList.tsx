import type { AgentQueuedTask } from "@/agentMode/session/AgentTaskCoordinator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clock, X } from "lucide-react";
import React from "react";

interface QueuedMessageListProps {
  tasks: readonly AgentQueuedTask[];
  onRemove: (taskId: string) => void;
}

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({ tasks, onRemove }) => {
  // Image-only turns need a visible queue label after the composer clears.
  // https://github.com/logancyang/obsidian-copilot/issues/2850
  return (
    <div className="tw-flex tw-max-h-24 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-px-2 tw-pb-1">
      {tasks.map(({ taskId, submission, queueReason }) => {
        const label =
          submission.requestText ||
          (submission.promptContent?.some((block) => block.type === "image")
            ? "Image attachment"
            : "Empty message");
        return (
          <div
            key={taskId}
            className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-rounded-md tw-bg-secondary-alt tw-px-2 tw-py-1 tw-text-ui-smaller"
            title={label}
          >
            <Clock
              className={cn(
                "tw-size-3 tw-shrink-0",
                queueReason === "context" ? "tw-text-warning" : "tw-text-muted"
              )}
            />
            <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-whitespace-nowrap tw-text-normal">
              {queueReason === "context" && (
                <span className="tw-font-semibold tw-text-warning">Waiting for context · </span>
              )}
              {label}
            </span>
            <Button
              variant="ghost2"
              size="fit"
              className="tw-shrink-0 tw-text-muted hover:tw-text-error"
              onClick={() => onRemove(taskId)}
              aria-label="Remove queued message"
            >
              <X className="tw-size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};
