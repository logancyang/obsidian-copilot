import {
  hasActivePaidLicense,
  hasVerifiedFeature,
  isEntitlementVerificationPending,
  subscribeToEntitlementChange,
} from "@/plusUtils";
import { getSettings } from "@/settings/model";
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

// A lapsed Supporter keeps their license key but no longer has an active paid plan; a device Sync brought the agents to, or a paid plan without custom agents, is asked for a Supporter key instead of told its plan ended.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/950
export function isLicenseLapsed(settings = getSettings()): boolean {
  return settings.plusLicenseKey !== "" && !hasActivePaidLicense(settings);
}

export function useCustomAgentsGate(): CustomAgentsGate {
  return useSyncExternalStore(subscribeToCustomAgentsGate, getCustomAgentsGate);
}
