import { AgentFace } from "@/agents/ui/AgentFace";
import { ChatAgentsContext, ChatRunsContext, type RunRef } from "@/agents/ui/chatAgents";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { MessageSquare } from "lucide-react";
import React, { useContext } from "react";

export interface AgentMessageCardProps {
  before?: string;
  name?: string;
  faceSrc?: string;
  after?: string;
  run?: RunRef;
}

// An @ shows in the asking chat as one card when the agent is asked and one when it answers, alike, naming the agent and opening the two agents' conversation, with none of its words.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/967
export const AgentMessageCard: React.FC<AgentMessageCardProps> = ({
  before,
  name,
  faceSrc,
  after,
  run,
}) => {
  const { agents, self, openRun } = useContext(ChatAgentsContext);
  const hasRun = useContext(ChatRunsContext);
  const from = agents.find((agent) => agent.slug === self)?.name ?? "Copilot";
  const open = openRun && run && hasRun(run) ? () => openRun(run) : undefined;
  return (
    <AgentActivityCard
      icon={MessageSquare}
      label={
        <>
          {before ? <span className="tw-shrink-0">{before}</span> : null}
          {faceSrc ? <AgentFace src={faceSrc} size="xs" className="tw-size-3.5" /> : null}
          {name ? <span className="tw-truncate tw-text-normal">{name}</span> : null}
          {after ? <span className="tw-shrink-0">{after}</span> : null}
        </>
      }
      onOpen={open}
      ariaLabel={open ? `Open ${from}'s conversation with ${name}` : undefined}
    />
  );
};
