import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { act } from "@testing-library/react";

export interface FakeAgentStore {
  store: CustomAgentStore;
  publish: (next: readonly CustomAgent[]) => void;
}

export function fakeAgentStore(initial: readonly CustomAgent[]): FakeAgentStore {
  let agents = initial;
  const listeners = new Set<() => void>();
  const store = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAgents: () => agents,
  } as unknown as CustomAgentStore;
  const publish = (next: readonly CustomAgent[]) =>
    act(() => {
      agents = next;
      listeners.forEach((listener) => listener());
    });
  return { store, publish };
}
