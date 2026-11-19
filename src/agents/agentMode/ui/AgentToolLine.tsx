import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { agentToolLineText, type AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentMessageCard } from "@/agents/agentMode/ui/AgentMessageCard";
import { AgentFace } from "@/agents/ui/AgentFace";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import React, { useContext } from "react";

export interface AgentToolLineProps {
  call: AgentToolCall;
  part: ToolCallPart;
  ordinaryRow: React.ReactNode;
}

export const AgentToolLine: React.FC<AgentToolLineProps> = ({ call, part, ordinaryRow }) => {
  const { agents, self } = useContext(ChatAgentsContext);
  const agent = agents.find(
    ({ name, slug }) => slug !== self && name.toLowerCase() === call.agent.toLowerCase()
  );
  // A call naming no agent this chat can ask (none listed without custom agents, itself, or a name that isn't an agent) was turned down, so it keeps its ordinary row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  if (!agent) return <>{ordinaryRow}</>;
  if (call.tool === ASK_AGENT_TOOL_NAME) {
    const asking = part.status === "pending" || part.status === "in_progress";
    return (
      <AgentMessageCard
        before={asking ? "Asking" : "Messaged"}
        name={agent.name}
        faceSrc={agent.faceSrc}
        after={asking ? "…" : undefined}
        run={{ callId: part.id, agent: agent.slug }}
      />
    );
  }
  return (
    <AgentActivityCard
      icon={<AgentFace src={agent.faceSrc} size="xs" className="tw-size-3.5" />}
      label={<span className="tw-truncate">{agentToolLineText(call, agent.name)}</span>}
    />
  );
};
