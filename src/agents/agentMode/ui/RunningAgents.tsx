import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import {
  RunningRow,
  StopTaskButton,
  type RunningRunsSlot,
} from "@/agentMode/ui/RunningTasksIndicator";
import type { AgentMention } from "@/agents/agentMentions";
import { formatRunTime, runningAgentsLine } from "@/agents/agentMentionStatus";
import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { useTickingNow } from "@/agents/agentMode/ui/AgentMentionStatus";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import type { CustomAgentsGate } from "@/agents/customAgentsGate";
import { AgentFace } from "@/agents/ui/AgentFace";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";
import React, { useRef } from "react";

const MAX_FACES = 3;

export interface RunningAgent {
  mention: AgentMention;
  message: string;
  faceSrc?: string;
}

interface RunningAgentsSlotInput {
  runs: readonly RunningAgent[];
  taskCount: number;
  onOpen: (mention: AgentMention) => void;
  onStop?: (mention: AgentMention) => void;
}

export function runningAgentsSlot({
  runs,
  taskCount,
  onOpen,
  onStop,
}: RunningAgentsSlotInput): RunningRunsSlot | undefined {
  if (runs.length === 0) return undefined;
  return {
    label: <RunningAgentsLabel runs={runs} taskCount={taskCount} />,
    rows: (close) =>
      runs.map((run) => (
        <li key={run.mention.id} className="tw-flex tw-items-start tw-gap-1">
          <RunningAgentRow
            run={run}
            onOpen={() => {
              close();
              onOpen(run.mention);
            }}
          />
          {onStop && (
            <StopTaskButton
              taskId={run.mention.id}
              label={`Stop ${run.mention.name}`}
              onStopTask={() => onStop(run.mention)}
            />
          )}
        </li>
      )),
  };
}

interface ChatRunningAgentsInput {
  messages: readonly AgentChatMessage[];
  chat: AgentSession | null;
  hiddenChats: HiddenAgentChats | undefined;
  agents: readonly CustomAgent[];
  taskCount: number;
  onOpen: (mention: AgentMention) => void;
  gate: CustomAgentsGate;
}

// A saved run can say working after its agent stopped, so the line lists only runs the plugin still holds; a run keeps going after the license lapses, but only a license that includes custom agents can stop it, as telling the chat's agent to stop does.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function chatRunningAgents({
  messages,
  chat,
  hiddenChats,
  agents,
  taskCount,
  onOpen,
  gate,
}: ChatRunningAgentsInput): RunningRunsSlot | undefined {
  const runs = messages
    .flatMap((message) => message.agentMentions ?? [])
    .flatMap((mention): RunningAgent[] => {
      const message = chat && hiddenChats?.workingOn(chat, mention.id);
      if (message == null) return [];
      const faceSrc = agents.find((agent) => agent.slug === mention.agent)?.faceSrc;
      return [{ mention, message, faceSrc }];
    });
  const onStop =
    gate === "full" && chat && hiddenChats
      ? (mention: AgentMention) => void hiddenChats.stop(chat, mention.agent, { fromList: true })
      : undefined;
  return runningAgentsSlot({ runs, taskCount, onOpen, onStop });
}

const RunningAgentsLabel: React.FC<{ runs: readonly RunningAgent[]; taskCount: number }> = ({
  runs,
  taskCount,
}) => {
  const line = runningAgentsLine(
    runs.map((run) => run.mention),
    taskCount
  );
  const ref = useRef<HTMLSpanElement>(null);
  const now = useTickingNow(line.clockFrom !== undefined, ref);
  const faces = [
    ...runs.filter((run) => run.mention.status !== "working"),
    ...runs.filter((run) => run.mention.status === "working"),
  ]
    .filter((run) => run.faceSrc)
    .slice(0, MAX_FACES);
  return (
    <span
      ref={ref}
      className={cn(
        "tw-flex tw-min-w-0 tw-items-center tw-gap-1.5",
        line.waiting && "tw-text-warning"
      )}
    >
      {faces.length > 0 && (
        <span className="tw-flex tw-shrink-0 tw-items-center -tw-space-x-1.5">
          {faces.map((run) => (
            <AgentFace
              key={run.mention.id}
              src={run.faceSrc!}
              size="xs"
              className="tw-ring-1 tw-ring-[color:var(--background-primary)]"
            />
          ))}
        </span>
      )}
      <span className="tw-truncate">
        {line.text}
        {line.clockFrom === undefined ? null : (
          <span className="tw-tabular-nums"> · {formatRunTime(now - line.clockFrom)}</span>
        )}
      </span>
    </span>
  );
};

const RunningAgentRow: React.FC<{ run: RunningAgent; onOpen: () => void }> = ({ run, onOpen }) => {
  const { mention, message, faceSrc } = run;
  const working = mention.status === "working";
  const ref = useRef<HTMLSpanElement>(null);
  const now = useTickingNow(working, ref);
  return (
    <RunningRow
      icon={
        faceSrc ? (
          <AgentFace src={faceSrc} size="xs" />
        ) : (
          <Bot className="tw-size-3.5 tw-shrink-0 tw-text-normal" />
        )
      }
      label={
        <>
          <span className="tw-font-medium">{mention.name}</span>{" "}
          <span className="tw-text-muted">{message}</span>
        </>
      }
      trailing={
        <span
          ref={ref}
          className={cn(
            "tw-shrink-0 tw-text-xs tw-tabular-nums",
            working ? "tw-text-muted" : "tw-text-warning"
          )}
        >
          {working
            ? formatRunTime(now - mention.startedAt)
            : mention.status === "permission"
              ? "Needs your OK"
              : "Waiting for you"}
        </span>
      }
      onOpen={onOpen}
    />
  );
};
