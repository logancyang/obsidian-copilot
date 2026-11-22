import {
  ensureEntitlement,
  hasVerifiedFeature,
  isEntitlementVerificationPending,
  subscribeToEntitlementChange,
} from "@/plusUtils";
import type { App } from "obsidian";
import { useSyncExternalStore } from "react";

export function isConnectorsEnabled(): boolean | undefined {
  // A stored token still being verified is unknown, so a Supporter's connectors never flash the upsell at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/856
  if (isEntitlementVerificationPending()) return undefined;
  return hasVerifiedFeature("connectors");
}

export function useIsConnectorsEnabled(): boolean | undefined {
  return useSyncExternalStore(subscribeToEntitlementChange, isConnectorsEnabled);
}

export function ensureConnectorsEntitlement(app?: App): Promise<boolean> {
  return ensureEntitlement(app, "connectors", () => isConnectorsEnabled() !== false);
}
