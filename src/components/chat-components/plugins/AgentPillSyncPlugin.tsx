import React from "react";
import { $isAgentPillNode, AgentPillNode } from "@/components/chat-components/pills/AgentPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface AgentPillSyncPluginProps {
  /** Backend ids of the agent pills currently in the editor. */
  onAgentsChange?: (backendIds: string[]) => void;
}

const agentPillConfig: PillSyncConfig<string> = {
  isPillNode: $isAgentPillNode,
  extractData: (node: LexicalNode) => (node as AgentPillNode).getBackendId(),
};

/**
 * Syncs the set of `@`-mentioned agent pills out to the composer so it can
 * resolve the structured `mentionedAgents` selection at send time.
 */
export function AgentPillSyncPlugin({ onAgentsChange }: AgentPillSyncPluginProps) {
  return <GenericPillSyncPlugin config={agentPillConfig} onChange={onAgentsChange} />;
}
