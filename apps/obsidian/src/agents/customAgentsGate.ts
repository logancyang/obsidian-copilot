import {
  hasVerifiedFeature,
  isEntitlementVerificationPending,
  subscribeToEntitlementChange,
} from "@/plusUtils";
import { useSyncExternalStore } from "react";

export type CustomAgentsGate = "pending" | "full" | "locked";

export function subscribeToCustomAgentsGate(listener: () => void): () => void {
  return subscribeToEntitlementChange(listener);
}

export function getCustomAgentsGate(): CustomAgentsGate {
  // A stored token still being verified is unknown, so a license with custom agents never flashes the locked state at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/934
  if (isEntitlementVerificationPending()) return "pending";
  if (hasVerifiedFeature("custom_agents")) return "full";
  return "locked";
}

export function useCustomAgentsGate(): CustomAgentsGate {
  return useSyncExternalStore(subscribeToCustomAgentsGate, getCustomAgentsGate);
}
