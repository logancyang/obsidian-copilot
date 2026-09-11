import type { AgentTaskDetails } from "@/agentMode/session/AgentMessageStore";
import type { AgentTaskRecord, AgentTaskState } from "@/agentMode/session/voiceTypes";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import type { App } from "obsidian";
import React from "react";

export interface AgentVoiceTaskCardProps {
  task: AgentTaskRecord;
  details?: AgentTaskDetails;
  backendDisplayName: string;
  app: App;
}
const TASK_LABELS: Record<AgentTaskState, string> = {
  queued: "Follow-up queued",
  running: "Working",
  "awaiting-user": "Needs your input",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function AgentVoiceTaskCard({
  task,
  details,
  backendDisplayName,
  app,
}: AgentVoiceTaskCardProps) {
  return (
    <details
      className="tw-m-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary"
      data-task-id={task.taskId}
    >
      <summary className="tw-cursor-pointer tw-p-3 tw-text-ui-small">
        <span>
          {backendDisplayName} · {TASK_LABELS[task.state]}
        </span>
        <span className="tw-ml-2 tw-text-muted">View details</span>
      </summary>
      {task.state === "queued" && (
        <p className="tw-m-0 tw-px-3 tw-pb-2 tw-text-ui-small tw-text-normal">
          Runs after the current task. This has not changed the running task.
        </p>
      )}
      {details && !details.activityAvailable && (
        <p className="tw-m-0 tw-px-3 tw-pb-2 tw-text-ui-small tw-text-normal">
          Activity details are unavailable for this saved task.
        </p>
      )}
      {details?.messages.map((message) => (
        <div key={message.id} className="tw-px-3 tw-pb-2">
          {message.parts?.length ? (
            <AgentTrail
              parts={message.parts}
              app={app}
              isStreaming={task.state === "running" || task.state === "awaiting-user"}
              turnStartedAtMs={message.timestamp?.epoch}
              turnDurationMs={message.turnDurationMs}
              timestamp={message.timestamp?.display}
              turnStopReason={message.turnStopReason}
            />
          ) : message.message ? (
            <ChatSingleMessage
              app={app}
              message={{ ...message, isVisible: true }}
              isStreaming={false}
            />
          ) : (
            <p className="tw-m-0 tw-text-ui-small tw-text-muted">
              Waiting for the agent's response…
            </p>
          )}
        </div>
      ))}
    </details>
  );
}
