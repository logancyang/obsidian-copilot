import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { agentToolLineText, type AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentFace } from "@/agents/ui/AgentFace";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import type { App } from "obsidian";
import React, { useContext } from "react";

export interface AgentToolLineProps {
  call: AgentToolCall;
  app: App;
  open: boolean;
  onToggle: () => void;
  ordinaryRow: React.ReactNode;
}

export const AgentToolLine: React.FC<AgentToolLineProps> = ({
  call,
  app,
  open,
  onToggle,
  ordinaryRow,
}) => {
  const { agents, self } = useContext(ChatAgentsContext);
  const agent = agents.find(
    ({ name, slug }) => slug !== self && name.toLowerCase() === call.agent.toLowerCase()
  );
  // A call naming no agent this chat can ask (none listed without custom agents, itself, or a name that isn't an agent) was turned down, so it keeps its ordinary row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  if (!agent) return <>{ordinaryRow}</>;
  const text = agentToolLineText(call, agent.name);
  return (
    <AgentActivityCard
      icon={<AgentFace src={agent.faceSrc} size="xs" className="tw-size-3.5" />}
      label={
        call.message ? (
          <>
            <span className="tw-shrink-0">{text}</span>
            <span className="tw-truncate tw-font-normal">· {call.message}</span>
          </>
        ) : (
          <span className="tw-truncate">{text}</span>
        )
      }
      expandable={call.message !== null}
      open={open}
      onToggle={onToggle}
    >
      {call.message ? <AgentMarkdownText text={call.message} app={app} /> : null}
    </AgentActivityCard>
  );
};
