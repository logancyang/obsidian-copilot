import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import type { AtMentionOption } from "@/components/chat-components/hooks/useAtMentionCategories";
import React from "react";

export function agentMentionOptions(
  agents: readonly CustomAgent[],
  query: string
): AtMentionOption[] {
  const wanted = query.trim().toLowerCase();
  return agents
    .filter((agent) => agent.name.toLowerCase().includes(wanted))
    .map((agent) => ({
      key: `custom-agent-${agent.slug}`,
      title: agent.name,
      subtitle: agentTitle(agent) || undefined,
      category: "customAgent",
      data: agent.slug,
      icon: <AgentFace src={agent.faceSrc} size="xs" />,
    }));
}
