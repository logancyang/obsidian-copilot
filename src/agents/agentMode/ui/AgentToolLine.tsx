import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { agentToolLineText, type AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentMessageCard } from "@/agents/agentMode/ui/AgentMessageCard";
import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
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
    ({ name, slug }) => slug !== self && name.toLowerCase() === call.agent?.toLowerCase()
  );
  const asking = part.status === "pending" || part.status === "in_progress";
  if (!agent) {
    // A call naming no agent this chat can ask (none listed without custom agents, itself, or a name that isn't an agent) was turned down, so once it ends it keeps its ordinary row.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
    if (call.tool !== ASK_AGENT_TOOL_NAME || !asking) return <>{ordinaryRow}</>;
    // A running ask that names no agent this chat can ask yet reads as the same card with a blank face, filled in once it names one, so the row never flips to the tool's name before it ends.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/967
    return <AgentMessageCard before="Asking" faceSrc={NEUTRAL_FACE_SRC} after="…" />;
  }
  if (call.tool === ASK_AGENT_TOOL_NAME) {
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
