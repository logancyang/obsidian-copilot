import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { CustomAgent } from "./type";

const customAgentsStore = createStore();
const customAgentsAtom = atom<CustomAgent[]>([]);
const activeAgentTitleAtom = atom<string>("");

/**
 * React hook to get all custom agents.
 */
export function useCustomAgents(): CustomAgent[] {
  return useAtomValue(customAgentsAtom, { store: customAgentsStore });
}

/**
 * React hook to get the currently active agent title.
 */
export function useActiveAgentTitle(): string {
  return useAtomValue(activeAgentTitleAtom, { store: customAgentsStore });
}

/**
 * Get cached custom agents (non-reactive).
 */
export function getCachedCustomAgents(): CustomAgent[] {
  return customAgentsStore.get(customAgentsAtom);
}

/**
 * Get active agent title (non-reactive).
 */
export function getActiveAgentTitle(): string {
  return customAgentsStore.get(activeAgentTitleAtom);
}

/**
 * Get the currently active agent definition, if any.
 */
export function getActiveAgent(): CustomAgent | undefined {
  const title = getActiveAgentTitle();
  if (!title) return undefined;
  return getCachedCustomAgents().find((a) => a.title === title);
}

/**
 * Update all custom agents in the store.
 */
export function updateCachedCustomAgents(agents: CustomAgent[]): void {
  customAgentsStore.set(customAgentsAtom, agents);
}

/**
 * Add or update a custom agent.
 */
export function upsertCachedCustomAgent(agent: CustomAgent): void {
  const agents = customAgentsStore.get(customAgentsAtom);
  const existingIndex = agents.findIndex((a) => a.title === agent.title);

  if (existingIndex !== -1) {
    const updated = [...agents];
    updated[existingIndex] = agent;
    customAgentsStore.set(customAgentsAtom, updated);
  } else {
    customAgentsStore.set(customAgentsAtom, [...agents, agent]);
  }
}

/**
 * Delete a custom agent by title.
 */
export function deleteCachedCustomAgent(title: string): void {
  const agents = customAgentsStore.get(customAgentsAtom);
  customAgentsStore.set(
    customAgentsAtom,
    agents.filter((a) => a.title !== title)
  );
  // Clear active agent if it was the deleted one
  if (getActiveAgentTitle() === title) {
    setActiveAgentTitle("");
  }
}

/**
 * Set the active agent title.
 */
export function setActiveAgentTitle(title: string): void {
  customAgentsStore.set(activeAgentTitleAtom, title);
}
