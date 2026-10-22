import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { useTaskOutputTail } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { TaskStatusMark } from "@/agentMode/ui/TaskCard";
import { taskKindLabel, taskTitle, type TaskDisplayStatus } from "@/agentMode/ui/taskDisplay";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { Button } from "@/components/ui/button";
import { USER_SENDER } from "@/constants";
import { logError } from "@/logger";
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
  chatAwaitsAnswer?: boolean;
}

export const TaskDetailView: React.FC<TaskDetailViewProps> = ({
  task,
  status = task.status,
  messages,
  app,
  onBack,
  chatAwaitsAnswer = false,
}) => {
  const Icon = task.kind === "command" ? Terminal : Bot;
  const subtitle =
    task.kind === "command"
      ? "Background command"
      : [taskKindLabel(task), task.model].filter(Boolean).join(" · ");

  return (
    <div
      className="tw-flex tw-size-full tw-min-h-0 tw-flex-col"
      data-testid="agent-task-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape") onBack();
      }}
    >
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-2 tw-py-1.5">
        <Button variant="ghost2" size="icon" aria-label="Back to chat" onClick={onBack} autoFocus>
          <ArrowLeft className="tw-size-4" />
        </Button>
        <Icon className="tw-size-4 tw-shrink-0 tw-text-normal" />
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
          <span className="tw-truncate tw-text-sm tw-font-medium tw-text-normal">
            {taskTitle(task)}
          </span>
          <span className="tw-truncate tw-text-xs tw-text-muted">{subtitle}</span>
        </div>
        <TaskStatusMark status={status} className="tw-text-muted" />
      </div>
      {/* Permission requests and questions show only in the main chat, so a task's view must point there. https://github.com/Brevilabs/obsidian-copilot-private/issues/749 */}
      {chatAwaitsAnswer ? (
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-bg-callout-warning/10 tw-px-3 tw-py-1 tw-text-xs tw-text-warning">
          The chat is waiting for your answer.
          <Button variant="link" size="fit" className="tw-shrink-0" onClick={onBack}>
            Open chat
          </Button>
        </div>
      ) : null}
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
  const parts = useMemo((): AgentMessagePart[] => {
    const own = messages.flatMap((m) => m.parts ?? []);
    // A subagent that shares none of its messages reports only through its notification summary. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    return own.length === 0 && task.summary ? [{ kind: "text", text: task.summary }] : own;
  }, [messages, task.summary]);
  const fileChanges = useMemo(() => messages.flatMap((m) => m.fileChanges ?? []), [messages]);
  const promptMessage = useMemo(
    () =>
      task.prompt
        ? { sender: USER_SENDER, message: task.prompt, timestamp: null, isVisible: true }
        : null,
    [task.prompt]
  );
  const { scrollRef, contentRef } = useStickToBottom();
  return (
    <div ref={scrollRef} className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
      <div ref={contentRef} className="tw-pb-3">
        {promptMessage ? (
          <ChatSingleMessage message={promptMessage} app={app} isStreaming={false} />
        ) : null}
        <div className="tw-px-3 tw-pt-2">
          {parts.length > 0 ? (
            <AgentTrail parts={parts} isStreaming={running} app={app} />
          ) : (
            <div className="tw-text-sm tw-text-muted">{running ? "Starting…" : "No activity"}</div>
          )}
          {fileChanges.length > 0 ? (
            <FilesChangedCard
              changes={fileChanges}
              onOpen={(change) =>
                void openTurnDiff(app, change, task.toolCallId).catch((error: unknown) =>
                  logError("[TaskDetailView] failed to open the subagent's diff", error)
                )
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

const CommandDetail: React.FC<{ task: AgentTask }> = ({ task }) => {
  const { scrollRef, contentRef } = useStickToBottom();
  const output = useTaskOutputTail(task.outputFile, {
    live: task.status === "running",
    maxBytes: COMMAND_OUTPUT_MAX_BYTES,
    shownRef: scrollRef,
  });
  return (
    <div ref={scrollRef} className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
      <div ref={contentRef} className="tw-flex tw-flex-col tw-gap-2 tw-p-3">
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
    </div>
  );
};

function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    let atBottom = true;
    const onScroll = () => {
      atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    };
    // Markdown renders after React commits, so the view follows the content's size, not its data. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    const resizes = new ResizeObserver(() => {
      if (atBottom) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll);
    resizes.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resizes.disconnect();
    };
  }, []);
  return { scrollRef, contentRef };
}
