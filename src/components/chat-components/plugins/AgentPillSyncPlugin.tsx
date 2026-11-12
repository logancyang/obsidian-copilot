import React from "react";
import { $isAgentPillNode, AgentPillNode } from "@/components/chat-components/pills/AgentPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface AgentPillSyncPluginProps {
  onAgentsChange?: (slugs: string[]) => void;
}

const agentPillConfig: PillSyncConfig<string> = {
  isPillNode: $isAgentPillNode,
  extractData: (node: LexicalNode) => (node as AgentPillNode).getAgentSlug(),
};

export function AgentPillSyncPlugin({ onAgentsChange }: AgentPillSyncPluginProps) {
  return <GenericPillSyncPlugin config={agentPillConfig} onChange={onAgentsChange} />;
}
