import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { createContext, useSyncExternalStore } from "react";

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);
const NO_STORE = { subscribe: () => () => {}, getAgents: () => NO_AGENTS };

export function useCustomAgents(store: CustomAgentStore | undefined): readonly CustomAgent[] {
  const gate = useCustomAgentsGate();
  const source = store ?? NO_STORE;
  const listed = useSyncExternalStore(source.subscribe, source.getAgents);
  return gate === "full" || gate === "locked" ? listed : NO_AGENTS;
}

export const CustomAgentStoreContext = createContext<CustomAgentStore | undefined>(undefined);
