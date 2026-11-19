import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { createContext, useContext, useMemo } from "react";

export interface ChatAgents {
  agents: readonly CustomAgent[];
  self: string | null;
  openRun?: (runId: string) => void;
}

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);

export const ChatAgentsContext = createContext<ChatAgents>(
  Object.freeze({ agents: NO_AGENTS, self: null })
);

export function useChatAgentsValue(
  store: CustomAgentStore | undefined,
  self: string | null,
  openRun?: (runId: string) => void
): ChatAgents {
  const agents = useCustomAgents(store);
  return useMemo(() => ({ agents, self, openRun }), [agents, self, openRun]);
}

export function useChatAgents(): readonly CustomAgent[] {
  return useContext(ChatAgentsContext).agents;
}

// An agent can't mention itself, so its own chat leaves it out; a Copilot chat has no agent and lists everyone.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function useMentionableAgents(): readonly CustomAgent[] {
  const { agents, self } = useContext(ChatAgentsContext);
  const gate = useCustomAgentsGate();
  return useMemo(() => {
    // A lapsed license still shows the agents' faces, but only a license that includes custom agents can ask one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
    if (gate !== "full") return NO_AGENTS;
    return self === null ? agents : agents.filter((agent) => agent.slug !== self);
  }, [gate, agents, self]);
}
