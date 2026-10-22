import type { AgentTask } from "@/agentMode/session/AgentSession";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import {
  taskBadgeStatus,
  taskKindLabel,
  taskStatusLabel,
  taskTitle,
} from "@/agentMode/ui/taskDisplay";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { Bot, Terminal } from "lucide-react";
import React from "react";

export interface TaskCardProps {
  task: AgentTask;
  onOpen: (taskId: string) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onOpen }) => (
  <AgentActivityCard
    icon={task.kind === "command" ? Terminal : Bot}
    label={
      <span className="tw-truncate">
        {task.kind === "command" ? taskTitle(task) : `${taskKindLabel(task)} · ${taskTitle(task)}`}
      </span>
    }
    trailing={
      <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-font-normal tw-text-muted">
        {taskStatusLabel(task.status)}
        <StatusBadge status={taskBadgeStatus(task.status)} />
      </span>
    }
    expandable
    onToggle={() => onOpen(task.taskId)}
  />
);
