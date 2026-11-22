import type { AskedAgentRequester as Requester } from "@/agentMode/session/types";
import { AgentFace } from "@/agents/ui/AgentFace";
import React from "react";

export interface AskedAgentRequesterProps {
  agent: Requester;
}

export const AskedAgentRequester: React.FC<AskedAgentRequesterProps> = ({ agent }) => (
  <span className="tw-inline-flex tw-items-center tw-gap-1 tw-align-bottom">
    <AgentFace src={agent.faceSrc} size="xs" />
    <strong>{agent.name}</strong>
  </span>
);
