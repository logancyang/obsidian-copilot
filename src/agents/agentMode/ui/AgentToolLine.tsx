import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { agentToolLineText, type AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { joinNames } from "@/agents/agentReply";
import { AgentFace } from "@/agents/ui/AgentFace";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { cn } from "@/lib/utils";
import type { App } from "obsidian";
import React, { useContext } from "react";

export interface AgentToolLineProps {
  calls: readonly AgentToolCall[];
  app: App;
  open: boolean;
  onToggle: () => void;
  ordinaryRow: React.ReactNode;
}

export const AgentToolLine: React.FC<AgentToolLineProps> = ({
  calls,
  app,
  open,
  onToggle,
  ordinaryRow,
}) => {
  const { agents, self } = useContext(ChatAgentsContext);
  const asked = calls.flatMap(({ agent: called, message }) => {
    const agent = agents.find(
      ({ name, slug }) => slug !== self && name.toLowerCase() === called.toLowerCase()
    );
    return agent ? [{ agent, message }] : [];
  });
  // A call naming no agent this chat can ask (none listed without custom agents, itself, or a name that isn't an agent) was turned down, so it keeps its ordinary row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  if (asked.length < calls.length) return <>{ordinaryRow}</>;
  const named = [...new Set(asked.map(({ agent }) => agent))];
  const sent = new Map(
    asked.flatMap(({ agent, message }) =>
      message ? [[`${agent.slug}\n${message}`, { name: agent.name, message }]] : []
    )
  );
  const text = agentToolLineText(calls[0], joinNames(named.map(({ name }) => name)));
  const message = calls[0].message;
  return (
    <AgentActivityCard
      icon={
        <span className="tw-flex">
          {named.map((agent, index) => (
            <AgentFace
              key={agent.slug}
              src={agent.faceSrc}
              size="xs"
              className={cn(
                "tw-size-3.5",
                index > 0 && "-tw-ml-1.5 tw-ring-1 tw-ring-[var(--background-primary)]"
              )}
            />
          ))}
        </span>
      }
      label={
        <>
          <span className={cn("tw-truncate", message && "tw-max-w-full tw-shrink-0")}>{text}</span>
          {message ? <span className="tw-truncate tw-font-normal">· {message}</span> : null}
        </>
      }
      expandable={message !== null}
      open={open}
      onToggle={onToggle}
    >
      {[...sent].map(([key, { name, message }]) => (
        <React.Fragment key={key}>
          {calls.length > 1 ? <div className="tw-font-medium tw-text-normal">{name}</div> : null}
          <AgentMarkdownText text={message} app={app} />
        </React.Fragment>
      ))}
    </AgentActivityCard>
  );
};
