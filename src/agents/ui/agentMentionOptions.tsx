import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace, LOCKED_FACE_CLASS } from "@/agents/ui/AgentFace";
import type {
  AtMentionOption,
  CategoryOption,
} from "@/components/chat-components/hooks/useAtMentionCategories";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import React from "react";

export const AGENTS_MENTION_CATEGORY: CategoryOption = {
  key: "agents",
  title: "Teammates",
  category: "agents",
  icon: <Users className="tw-size-4" />,
};

export function agentMentionOptions(
  agents: readonly CustomAgent[],
  query: string,
  lockedNote: (agent: CustomAgent) => string | undefined = () => undefined
): AtMentionOption[] {
  const wanted = query.trim().toLowerCase();
  return agents
    .filter((agent) => agent.name.toLowerCase().includes(wanted))
    .map((agent) => {
      const note = lockedNote(agent);
      return {
        key: `custom-agent-${agent.slug}`,
        title: agent.name,
        subtitle: agentTitle(agent) || undefined,
        category: "customAgent",
        data: agent.slug,
        icon: <AgentFace src={agent.faceSrc} size="xs" className={cn(note && LOCKED_FACE_CLASS)} />,
        ...(note ? { lockedNote: note } : {}),
      };
    });
}
