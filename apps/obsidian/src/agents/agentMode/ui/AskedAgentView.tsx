import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { TaskDetailFrame, useStickToBottom } from "@/agentMode/ui/TaskDetailView";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import type { AgentMention } from "@/agents/agentMentions";
import { relayRuns } from "@/agents/agentMode/agentRelays";
import {
  readAskedMessage,
  type AskedAgentChat,
  type HiddenAgentChats,
} from "@/agents/agentMode/hiddenAgentChats";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { USER_SENDER } from "@/constants";
import { formatMessageClock, formatMessageDateTime } from "@/lib/messageTime";
import { logError } from "@/logger";
import { ArrowRightLeft, Bot } from "lucide-react";
import type { App } from "obsidian";
import React, { useEffect, useState } from "react";

const NO_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);
const NO_REPLIES: ReadonlyMap<string, string> = new Map();

export interface AskedAgentViewProps {
  run: AgentMention;
  from: string;
  fromFaceSrc?: string;
  faceSrc?: string;
  chat: AskedAgentChat | null;
  replies?: ReadonlyMap<string, string>;
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
  replies = NO_REPLIES,
  app,
  onBack,
}) => {
  const messages = useChatMessages(chat?.session ?? null);
  const waitsOn =
    run.status === "question"
      ? `${run.name} asked a question in ${from}'s chat.`
      : run.status === "permission"
        ? `${run.name} needs your OK in ${from}'s chat.`
        : null;
  // The view takes the chat's place, header included, and its one row names the two agents whose conversation it is.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/967
  return (
    <TaskDetailFrame
      title={
        <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
          {fromFaceSrc ? (
            <AgentFace src={fromFaceSrc} size="s" />
          ) : (
            <CopilotBrandIcon className="tw-size-4" />
          )}
          <span className="tw-truncate">{from}</span>
          <ArrowRightLeft className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
          {faceSrc ? (
            <AgentFace src={faceSrc} size="s" />
          ) : (
            <Bot className="tw-size-4 tw-shrink-0" />
          )}
          <span className="tw-truncate">{run.name}</span>
        </span>
      }
      onBack={onBack}
      backLabel={`Back to ${from}`}
      banner={waitsOn ? { text: waitsOn, action: "Answer there" } : null}
    >
      <AskedAgentSteps
        run={run}
        from={from}
        chat={chat}
        messages={messages}
        replies={replies}
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
  messages: readonly AgentChatMessage[];
  agents: readonly CustomAgent[];
  app: App;
  onBack: () => void;
}

export const ChatAskedAgentView: React.FC<ChatAskedAgentViewProps> = ({
  run,
  chat,
  hiddenChats,
  messages,
  agents,
  app,
  onBack,
}) => {
  const asking = agents.find((agent) => agent.slug === chat?.agentSlug);
  const replies = new Map(
    [...relayRuns(messages)]
      .filter(([, { relay }]) => relay.marker.mention === run.id && relay.reply)
      .map(([id, { relay }]) => [id, relay.reply])
  );
  return (
    <AskedAgentView
      run={run}
      from={asking?.name ?? "Copilot"}
      fromFaceSrc={asking?.faceSrc}
      faceSrc={agents.find((agent) => agent.slug === run.agent)?.faceSrc}
      chat={chat && hiddenChats ? hiddenChats.askedChat(chat, run) : null}
      replies={replies}
      app={app}
      onBack={onBack}
    />
  );
};

interface AskedAgentStepsProps {
  run: AgentMention;
  from: string;
  chat: AskedAgentChat | null;
  messages: readonly AgentChatMessage[];
  replies: ReadonlyMap<string, string>;
  app: App;
}

const AskedAgentSteps: React.FC<AskedAgentStepsProps> = ({
  run,
  from,
  chat,
  messages,
  replies,
  app,
}) => {
  const { scrollRef, contentRef, endRef } = useStickToBottom();
  const responding = chat?.session.getStatus() === "running";
  const nextRun = chat && [...chat.continuedAt].find(([, at]) => at > run.startedAt)?.[0];
  return (
    <div ref={scrollRef} className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
      <div ref={contentRef} className="tw-flex tw-flex-col tw-gap-2 tw-py-2">
        {!chat && run.status !== "working" ? (
          <>
            <div className="tw-px-3 tw-text-sm tw-text-muted">
              {run.name}&apos;s steps from this run are no longer available.
            </div>
            {/* The asked agent's chat lives only while Obsidian keeps it open, but the asking chat saved its words in the relay, so they stay readable after a restart. https://github.com/Brevilabs/obsidian-copilot-private/issues/967 */}
            {[...replies].map(([id, reply]) => (
              <div key={id} className="tw-px-3">
                <AgentTrail parts={[{ kind: "text", text: reply }]} isStreaming={false} app={app} />
              </div>
            ))}
          </>
        ) : !chat || messages.length === 0 ? (
          <div className="tw-px-3 tw-text-sm tw-text-muted">Starting…</div>
        ) : (
          messages.map((message, index) =>
            message.sender === USER_SENDER ? (
              <React.Fragment key={message.id}>
                {index > 0 && chat.continuedAt.has(message.id) ? (
                  <ContinuedAt
                    at={chat.continuedAt.get(message.id)!}
                    endRef={message.id === nextRun ? endRef : undefined}
                  />
                ) : null}
                <AskedMessage message={message} from={from} app={app} />
              </React.Fragment>
            ) : (
              <div key={message.id} className="tw-px-3">
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
              </div>
            )
          )
        )}
      </div>
    </div>
  );
};

// What the asking agent sent reads as a user's message does in a chat; an answer it passed on says it was the user's.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/967
const AskedMessage: React.FC<{ message: AgentChatMessage; from: string; app: App }> = ({
  message,
  from,
  app,
}) => {
  const asked = readAskedMessage(message.message);
  return (
    <div>
      {asked?.answer ? (
        <div className="tw-px-3 tw-text-xs tw-text-muted">{from} passed on your answer</div>
      ) : null}
      <ChatSingleMessage
        message={{
          sender: USER_SENDER,
          message: asked?.text ?? message.message,
          timestamp: message.timestamp,
          isVisible: true,
        }}
        app={app}
        isStreaming={false}
      />
    </div>
  );
};

const ContinuedAt: React.FC<{ at: number; endRef?: React.Ref<HTMLDivElement> }> = ({
  at,
  endRef,
}) => (
  <div
    ref={endRef}
    title={formatMessageDateTime(at)}
    className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-text-xs tw-text-faint"
  >
    <span className="copilot-divider-b tw-flex-1" />
    Continued at {formatMessageClock(at)}
    <span className="copilot-divider-b tw-flex-1" />
  </div>
);

function useChatMessages(session: AgentSession | null): readonly AgentChatMessage[] {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!session) return;
    const refresh = () => setRevision((revision) => revision + 1);
    return session.subscribe({ onMessagesChanged: refresh, onStatusChanged: refresh });
  }, [session]);
  return session?.store.getDisplayMessages() ?? NO_MESSAGES;
}
