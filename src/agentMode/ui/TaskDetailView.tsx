import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { useTaskOutputTail } from "@/agentMode/ui/hooks/useTaskOutputTail";
import {
  taskBadgeStatus,
  taskKindLabel,
  taskStatusLabel,
  taskTitle,
  type TaskDisplayStatus,
} from "@/agentMode/ui/taskDisplay";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { Button } from "@/components/ui/button";
import { USER_SENDER } from "@/constants";
import { ArrowLeft, Bot, Terminal } from "lucide-react";
import type { App } from "obsidian";
import React, { useLayoutEffect, useMemo, useRef } from "react";

export const COMMAND_OUTPUT_MAX_BYTES = 256 * 1024;
const STICK_TO_BOTTOM_PX = 24;

export interface TaskDetailViewProps {
  task: AgentTask;
  status?: TaskDisplayStatus;
  messages: readonly AgentChatMessage[];
  app: App;
  onBack: () => void;
}

export const TaskDetailView: React.FC<TaskDetailViewProps> = ({
  task,
  status = task.status,
  messages,
  app,
  onBack,
}) => {
  const Icon = task.kind === "command" ? Terminal : Bot;
  const subtitle =
    task.kind === "command"
      ? "Background command"
      : [taskKindLabel(task), task.model].filter(Boolean).join(" · ");

  return (
    <div className="tw-flex tw-size-full tw-min-h-0 tw-flex-col" data-testid="agent-task-detail">
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-2 tw-py-1.5">
        <Button variant="ghost2" size="icon" aria-label="Back to chat" onClick={onBack}>
          <ArrowLeft className="tw-size-4" />
        </Button>
        <Icon className="tw-size-4 tw-shrink-0 tw-text-normal" />
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
          <span className="tw-truncate tw-text-sm tw-font-medium tw-text-normal">
            {taskTitle(task)}
          </span>
          <span className="tw-truncate tw-text-xs tw-text-muted">{subtitle}</span>
        </div>
        <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-text-muted">
          {taskStatusLabel(status)}
          <StatusBadge status={taskBadgeStatus(status)} />
        </span>
      </div>
      {task.kind === "command" ? (
        <CommandDetail task={task} />
      ) : (
        <SubagentDetail task={task} messages={messages} app={app} />
      )}
    </div>
  );
};

const SubagentDetail: React.FC<{
  task: AgentTask;
  messages: readonly AgentChatMessage[];
  app: App;
}> = ({ task, messages, app }) => {
  const running = task.status === "running";
  const parts = useMemo(() => messages.flatMap((m) => m.parts ?? []), [messages]);
  const promptMessage = useMemo(
    () =>
      task.prompt
        ? { sender: USER_SENDER, message: task.prompt, timestamp: null, isVisible: true }
        : null,
    [task.prompt]
  );
  const scrollRef = useStickToBottom(parts);
  return (
    <div ref={scrollRef} className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-pb-3">
      {promptMessage ? (
        <ChatSingleMessage message={promptMessage} app={app} isStreaming={false} />
      ) : null}
      <div className="tw-px-3 tw-pt-2">
        {parts.length > 0 ? (
          <AgentTrail parts={parts} isStreaming={running} app={app} />
        ) : (
          <div className="tw-text-sm tw-text-muted">{running ? "Starting…" : "No activity"}</div>
        )}
      </div>
    </div>
  );
};

const CommandDetail: React.FC<{ task: AgentTask }> = ({ task }) => {
  const output = useTaskOutputTail(task.outputFile, {
    live: task.status === "running",
    maxBytes: COMMAND_OUTPUT_MAX_BYTES,
  });
  const scrollRef = useStickToBottom(output.text);
  return (
    <div
      ref={scrollRef}
      className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2 tw-overflow-y-auto tw-p-3"
    >
      {task.command ? (
        <pre className="tw-m-0 tw-whitespace-pre-wrap tw-break-words tw-rounded tw-bg-secondary-alt tw-p-2 tw-font-mono tw-text-xs tw-text-normal">
          $ {task.command}
        </pre>
      ) : null}
      {output.truncated ? (
        <div className="tw-text-xs tw-text-muted">Showing the last 256 KB of output.</div>
      ) : null}
      <pre
        data-testid="task-command-output"
        className="tw-m-0 tw-whitespace-pre-wrap tw-break-words tw-font-mono tw-text-xs tw-text-normal"
      >
        {output.text || (task.status === "running" ? "No output yet" : "No output")}
      </pre>
    </div>
  );
};

function useStickToBottom(content: unknown): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [content]);
  return ref;
}
