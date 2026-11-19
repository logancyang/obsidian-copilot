import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { useSyncExternalStore } from "react";

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);
const NO_STORE = { subscribe: () => () => {}, getAgents: () => NO_AGENTS };

export function useCustomAgents(store: CustomAgentStore | undefined): readonly CustomAgent[] {
  const gate = useCustomAgentsGate();
  const source = store ?? NO_STORE;
  const listed = useSyncExternalStore(source.subscribe, source.getAgents);
  return gate === "full" ? listed : NO_AGENTS;
}
