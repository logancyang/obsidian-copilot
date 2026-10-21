import type { AgentTask } from "@/agentMode/session/AgentSession";
import { lastOutputLine } from "@/agentMode/session/taskOutputTail";
import type { PermissionPrompt } from "@/agentMode/session/types";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { useTaskOutputTail } from "@/agentMode/ui/hooks/useTaskOutputTail";
import {
  runningTasks,
  taskBadgeStatus,
  taskDisplayStatus,
  taskKindLabel,
  taskStatusLabel,
  taskTitle,
} from "@/agentMode/ui/taskDisplay";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import { Bot, Loader2, Terminal } from "lucide-react";
import React, { useRef, useState } from "react";

const ROW_OUTPUT_BYTES = 4096;
const HOVER_CLOSE_MS = 150;

interface RunningTasksIndicatorProps {
  tasks: readonly AgentTask[];
  permissions: readonly PermissionPrompt[];
  onOpenTask: (taskId: string) => void;
  container?: HTMLElement | null;
  defaultOpen?: boolean;
}

export const RunningTasksIndicator: React.FC<RunningTasksIndicatorProps> = ({
  tasks,
  permissions,
  onOpenTask,
  container,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const closeTimer = useRef<number | null>(null);
  const running = runningTasks(tasks);
  if (running.length === 0) return null;

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted hover:tw-text-normal"
          onPointerEnter={show}
          onPointerLeave={hideSoon}
        >
          <Loader2 className="tw-size-3 tw-animate-spin tw-text-loading" />
          {pluralize(running.length, "task")} running
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        side="top"
        align="start"
        className="tw-w-80 tw-max-w-[calc(100vw-2rem)] tw-p-1"
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-p-0">
          {running.map((task) => (
            <li key={task.taskId}>
              <RunningTaskRow
                task={task}
                status={taskDisplayStatus(task, permissions)}
                onOpen={() => {
                  setOpen(false);
                  onOpenTask(task.taskId);
                }}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

interface RunningTaskRowProps {
  task: AgentTask;
  status: ReturnType<typeof taskDisplayStatus>;
  onOpen: () => void;
}

const RunningTaskRow: React.FC<RunningTaskRowProps> = ({ task, status, onOpen }) => {
  const Icon = task.kind === "command" ? Terminal : Bot;
  return (
    <button
      type="button"
      className="tw-flex tw-h-auto tw-w-full tw-flex-col tw-items-stretch tw-gap-0.5 tw-rounded tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none hover:tw-bg-modifier-hover"
      onClick={onOpen}
    >
      <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-sm">
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-normal" />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-normal">
          {task.kind === "command"
            ? taskTitle(task)
            : `${taskKindLabel(task)} · ${taskTitle(task)}`}
        </span>
        <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-text-muted">
          {taskStatusLabel(status)}
          <StatusBadge status={taskBadgeStatus(status)} />
        </span>
      </span>
      {task.kind === "command" ? <CommandOutputLine outputFile={task.outputFile} /> : null}
    </button>
  );
};

const CommandOutputLine: React.FC<{ outputFile: string | undefined }> = ({ outputFile }) => {
  const output = useTaskOutputTail(outputFile, { live: true, maxBytes: ROW_OUTPUT_BYTES });
  const line = lastOutputLine(output.text);
  return (
    <span className="tw-truncate tw-pl-5 tw-font-mono tw-text-xs tw-text-muted">
      {line || "No output yet"}
    </span>
  );
};
