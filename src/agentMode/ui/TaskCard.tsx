import type { AgentTask } from "@/agentMode/session/AgentSession";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import {
  taskBadgeStatus,
  taskLabel,
  taskStatusLabel,
  type TaskDisplayStatus,
} from "@/agentMode/ui/taskDisplay";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { cn } from "@/lib/utils";
import { Bot, Terminal } from "lucide-react";
import React from "react";

export interface TaskCardProps {
  task: AgentTask;
  onOpen: (toolCallId: string) => void;
}

// Each status icon speaks for itself except "Needs approval", which shares the running spinner. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export const TaskStatusMark: React.FC<{ status: TaskDisplayStatus; className?: string }> = ({
  status,
  className,
}) => (
  <span className={cn("tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs", className)}>
    {status === "needs_approval" ? (
      taskStatusLabel(status)
    ) : (
      <span className="tw-sr-only">{taskStatusLabel(status)}</span>
    )}
    <StatusBadge status={taskBadgeStatus(status)} />
  </span>
);

export const TaskCard: React.FC<TaskCardProps> = ({ task, onOpen }) => (
  <AgentActivityCard
    icon={task.kind === "command" ? Terminal : Bot}
    label={<span className="tw-truncate">{taskLabel(task)}</span>}
    trailing={<TaskStatusMark status={task.status} className="tw-font-normal tw-text-muted" />}
    expandable
    onToggle={() => onOpen(task.toolCallId)}
  />
);
