import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import {
  revealSessionsSidebar,
  type SessionsSidebarHost,
} from "@/agentMode/navigator/revealSessionsSidebar";
import type { Component } from "obsidian";
import {
  ensureNavigatorEntitlement,
  isNavigatorEnabled,
} from "@/agentMode/navigator/navigatorEntitlement";
import { subscribeToEntitlementChange } from "@/plusUtils";

export type NavigatorHost = SessionsSidebarHost & Component;

const hostsAwaitingUnlock = new WeakSet<NavigatorHost>();

export function openNavigatorWhenUnlocked(host: NavigatorHost): void {
  // A Supporter who unlocks preview from a Navigator prompt lands in the Navigator without finding its icon again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (hostsAwaitingUnlock.has(host)) return;
  hostsAwaitingUnlock.add(host);
  const unsubscribe = subscribeToEntitlementChange(() => {
    if (isNavigatorEnabled() !== true) return;
    unsubscribe();
    hostsAwaitingUnlock.delete(host);
    void revealSessionsSidebar(host);
  });
  host.register(unsubscribe);
}

export async function openSessionsSidebar(host: NavigatorHost): Promise<void> {
  // The Navigator is a Supporter preview; its entry points stay visible and explain it instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (!(await ensureNavigatorEntitlement(host.app))) {
    new NavigatorUpsellModal(host.app).open();
    openNavigatorWhenUnlocked(host);
    return;
  }
  await revealSessionsSidebar(host);
}
