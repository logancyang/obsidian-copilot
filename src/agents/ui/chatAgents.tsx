import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { createContext, useContext, useMemo } from "react";

export type RunRef = { runId: string } | { callId: string; agent: string };

export interface ChatAgents {
  agents: readonly CustomAgent[];
  self: string | null;
  openRun?: (run: RunRef) => void;
  needsSetup?: Pick<ReadonlySet<string>, "has">;
  openProfile?: (slug: string) => void;
}

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);

export const ChatAgentsContext = createContext<ChatAgents>(
  Object.freeze({ agents: NO_AGENTS, self: null })
);

// A card opens only a run the chat can find, which changes with each message, so the lookup has its own context and the rest of the chat doesn't render again on every message.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/976
export const ChatRunsContext = createContext<(run: RunRef) => boolean>(() => false);

export function useChatAgentsValue(
  store: CustomAgentStore | undefined,
  self: string | null,
  { openRun, needsSetup, openProfile }: Omit<ChatAgents, "agents" | "self"> = {}
): ChatAgents {
  const agents = useCustomAgents(store);
  return useMemo(
    () => ({ agents, self, openRun, needsSetup, openProfile }),
    [agents, self, openRun, needsSetup, openProfile]
  );
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
    // Locked custom agents still show their faces, but only a license that includes custom agents can ask one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
    if (gate !== "full") return NO_AGENTS;
    return self === null ? agents : agents.filter((agent) => agent.slug !== self);
  }, [gate, agents, self]);
}
