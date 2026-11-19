import {
  hasVerifiedFeature,
  isEntitlementVerificationPending,
  subscribeToEntitlementChange,
} from "@/plusUtils";
import { useSyncExternalStore } from "react";

export type CustomAgentsGate = "pending" | "full" | "locked" | "hidden";

export const launched: boolean = false;

export function subscribeToCustomAgentsGate(listener: () => void): () => void {
  return subscribeToEntitlementChange(listener);
}

export function getCustomAgentsGate(): CustomAgentsGate {
  // A stored token still being verified is unknown, so a team license never flashes the locked or hidden state at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/934
  if (isEntitlementVerificationPending()) return "pending";
  if (hasVerifiedFeature("custom_agents")) return "full";
  return launched ? "locked" : "hidden";
}

export function useCustomAgentsGate(): CustomAgentsGate {
  return useSyncExternalStore(subscribeToCustomAgentsGate, getCustomAgentsGate);
}
