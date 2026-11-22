import {
  ensureEntitlement,
  hasVerifiedFeature,
  isEntitlementVerificationPending,
  subscribeToEntitlementChange,
} from "@/plusUtils";
import type { App } from "obsidian";
import { useSyncExternalStore } from "react";

export function isNavigatorEnabled(): boolean | undefined {
  // A stored token still being verified is unknown, so a Supporter's restored Navigator never flashes its upsell at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (isEntitlementVerificationPending()) return undefined;
  return hasVerifiedFeature("navigator");
}

export function useIsNavigatorEnabled(): boolean | undefined {
  return useSyncExternalStore(subscribeToEntitlementChange, isNavigatorEnabled);
}

export function ensureNavigatorEntitlement(app?: App): Promise<boolean> {
  return ensureEntitlement(app, "navigator", () => isNavigatorEnabled() !== false);
}
