import type { AgentSession } from "@/agentMode/session/AgentSession";
import { findModelEntry } from "@/agentMode/session/translateBackendState";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { TaskDetailFrame, useStickToBottom } from "@/agentMode/ui/TaskDetailView";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import type { AgentMention, AgentMentionStatus } from "@/agents/agentMentions";
import { formatRunTime, mentionStatusLine } from "@/agents/agentMentionStatus";
import {
  readAskedMessage,
  type AskedAgentChat,
  type HiddenAgentChats,
} from "@/agents/agentMode/hiddenAgentChats";
import { useTickingNow } from "@/agents/agentMode/ui/AgentMentionStatus";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Bot } from "lucide-react";
import type { App } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

const NO_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);

const RUN_STATE: Record<AgentMentionStatus, string> = {
  working: "Working",
  question: "Waiting for you",
  permission: "Needs your OK",
  finished: "Finished",
  stopped: "Stopped",
  didnt_finish: "Didn't finish",
};

export interface AskedAgentViewProps {
  run: AgentMention;
  from: string;
  fromFaceSrc?: string;
  faceSrc?: string;
  chat: AskedAgentChat | null;
  app: App;
  onBack: () => void;
}

// An asked agent works in a chat no list shows, so the user watches it here, read-only, from the chat that asked it; telling it anything goes through that chat's agent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export const AskedAgentView: React.FC<AskedAgentViewProps> = ({
  run,
  from,
  fromFaceSrc,
  faceSrc,
  chat,
  app,
  onBack,
}) => {
  const messages = useChatMessages(chat?.session ?? null);
  const model = chat ? modelName(chat.session) : null;
  const waitsOn =
    run.status === "question"
      ? `${run.name} asked a question in ${from}'s chat.`
      : run.status === "permission"
        ? `${run.name} needs your OK in ${from}'s chat.`
        : null;
  return (
    <TaskDetailFrame
      icon={
        faceSrc ? (
          <AgentFace src={faceSrc} size="s" />
        ) : (
          <Bot className="tw-size-4 tw-shrink-0 tw-text-normal" />
        )
      }
      title={run.name}
      subtitle={[`Sent by ${from}`, model].filter(Boolean).join(" · ")}
      status={<RunState run={run} />}
      onBack={onBack}
      backLabel={`Back to ${from}`}
      banner={waitsOn ? { text: waitsOn, action: "Answer there" } : null}
    >
      <AskedAgentSteps
        run={run}
        from={from}
        fromFaceSrc={fromFaceSrc}
        chat={chat}
        messages={messages}
        app={app}
      />
      <div className="copilot-divider-t tw-px-3 tw-py-2 tw-text-xs tw-text-muted">
        You can only watch here. To tell {run.name} something, tell {from}.
      </div>
    </TaskDetailFrame>
  );
};

interface ChatAskedAgentViewProps {
  run: AgentMention;
  chat: AgentSession | null;
  hiddenChats: HiddenAgentChats | undefined;
  agents: readonly CustomAgent[];
  app: App;
  onBack: () => void;
}

export const ChatAskedAgentView: React.FC<ChatAskedAgentViewProps> = ({
  run,
  chat,
  hiddenChats,
  agents,
  app,
  onBack,
}) => {
  const asking = agents.find((agent) => agent.slug === chat?.agentSlug);
  return (
    <AskedAgentView
      run={run}
      from={asking?.name ?? "Copilot"}
      fromFaceSrc={asking?.faceSrc}
      faceSrc={agents.find((agent) => agent.slug === run.agent)?.faceSrc}
      chat={chat && hiddenChats ? hiddenChats.askedChat(chat, run) : null}
      app={app}
      onBack={onBack}
    />
  );
};

const RunState: React.FC<{ run: AgentMention }> = ({ run }) => {
  const line = mentionStatusLine(run);
  const ref = useRef<HTMLSpanElement>(null);
  const now = useTickingNow(line.clock === "ticking", ref);
  // A run waiting on the user saves no time it started waiting, so the view shows no clock then rather than one that disagrees with the line under the message.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/948
  const elapsedMs = line.clock === "ticking" ? now - run.startedAt : line.elapsedMs;
  return (
    <span
      ref={ref}
      className={cn(
        "tw-shrink-0 tw-text-xs tw-tabular-nums",
        line.tone === "waiting"
          ? "tw-text-warning"
          : line.tone === "failed"
            ? "tw-text-error"
            : "tw-text-muted"
      )}
    >
      {RUN_STATE[run.status]}
      {elapsedMs === undefined ? null : ` · ${formatRunTime(elapsedMs)}`}
    </span>
  );
};

interface AskedAgentStepsProps {
  run: AgentMention;
  from: string;
  fromFaceSrc?: string;
  chat: AskedAgentChat | null;
  messages: readonly AgentChatMessage[];
  app: App;
}

const AskedAgentSteps: React.FC<AskedAgentStepsProps> = ({
  run,
  from,
  fromFaceSrc,
  chat,
  messages,
  app,
}) => {
  const { scrollRef, contentRef } = useStickToBottom();
  const responding = chat?.session.getStatus() === "running";
  return (
    <div ref={scrollRef} className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
      <div ref={contentRef} className="tw-flex tw-flex-col tw-gap-3 tw-p-3">
        {!chat && run.status !== "working" ? (
          <div className="tw-text-sm tw-text-muted">
            {run.name}&apos;s steps from this run are no longer available.
          </div>
        ) : !chat || messages.length === 0 ? (
          <div className="tw-text-sm tw-text-muted">Starting…</div>
        ) : (
          messages.map((message, index) =>
            message.sender === USER_SENDER ? (
              <React.Fragment key={message.id}>
                {index > 0 && chat.continuedAt.has(message.id) ? (
                  <ContinuedAt at={chat.continuedAt.get(message.id)!} />
                ) : null}
                <AskedMessage
                  message={message}
                  from={from}
                  name={run.name}
                  fromFaceSrc={fromFaceSrc}
                />
              </React.Fragment>
            ) : (
              <React.Fragment key={message.id}>
                <AgentTrail
                  parts={message.parts ?? []}
                  isStreaming={responding && index === messages.length - 1}
                  app={app}
                  errorText={message.isErrorMessage ? message.message : undefined}
                />
                {message.fileChanges?.length ? (
                  <FilesChangedCard
                    changes={message.fileChanges}
                    onOpen={(change) =>
                      void openTurnDiff(app, change, message.id).catch((error: unknown) =>
                        logError("[Custom agents] failed to open an asked agent's diff", error)
                      )
                    }
                  />
                ) : null}
              </React.Fragment>
            )
          )
        )}
      </div>
    </div>
  );
};

const AskedMessage: React.FC<{
  message: AgentChatMessage;
  from: string;
  name: string;
  fromFaceSrc?: string;
}> = ({ message, from, name, fromFaceSrc }) => {
  const asked = readAskedMessage(message.message);
  const at = message.timestamp ? ` · ${clockTime(message.timestamp.epoch)}` : "";
  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-rounded tw-bg-secondary-alt tw-p-2 tw-text-sm">
      <span className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-muted">
        {fromFaceSrc && <AgentFace src={fromFaceSrc} size="xs" />}
        {asked?.answer ? `${from} passed on your answer` : `${from} asked ${name}`}
        {at}
      </span>
      <span className="tw-select-text tw-whitespace-pre-wrap tw-break-words tw-text-normal">
        {asked?.text ?? message.message}
      </span>
    </div>
  );
};

const ContinuedAt: React.FC<{ at: number }> = ({ at }) => (
  <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-faint">
    <span className="copilot-divider-b tw-flex-1" />
    Continued at {clockTime(at)}
    <span className="copilot-divider-b tw-flex-1" />
  </div>
);

function clockTime(epoch: number): string {
  const date = new Date(epoch);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function modelName(session: AgentSession): string | null {
  const model = session.getState()?.model;
  return model ? (findModelEntry(model, model.current.baseModelId)?.name ?? null) : null;
}

function useChatMessages(session: AgentSession | null): readonly AgentChatMessage[] {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!session) return;
    const refresh = () => setRevision((revision) => revision + 1);
    return session.subscribe({ onMessagesChanged: refresh, onStatusChanged: refresh });
  }, [session]);
  return session?.store.getDisplayMessages() ?? NO_MESSAGES;
}
