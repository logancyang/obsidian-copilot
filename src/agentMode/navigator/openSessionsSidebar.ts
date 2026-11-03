import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import { revealSessionsSidebar } from "@/agentMode/navigator/revealSessionsSidebar";
import type CopilotPlugin from "@/main";
import {
  ensureNavigatorEntitlement,
  isNavigatorEnabled,
  subscribeToEntitlementChange,
} from "@/plusUtils";

const pluginsAwaitingUnlock = new WeakSet<CopilotPlugin>();

export function openNavigatorWhenUnlocked(plugin: CopilotPlugin): void {
  // A Supporter who unlocks preview from a Navigator prompt lands in the Navigator without finding its icon again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (pluginsAwaitingUnlock.has(plugin)) return;
  pluginsAwaitingUnlock.add(plugin);
  const unsubscribe = subscribeToEntitlementChange(() => {
    if (isNavigatorEnabled() !== true) return;
    unsubscribe();
    pluginsAwaitingUnlock.delete(plugin);
    void revealSessionsSidebar(plugin);
  });
  plugin.register(unsubscribe);
}

export async function openSessionsSidebar(plugin: CopilotPlugin): Promise<void> {
  // The Navigator is a Supporter preview; its entry points stay visible and explain it instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (!(await ensureNavigatorEntitlement(plugin.app))) {
    new NavigatorUpsellModal(plugin.app).open();
    openNavigatorWhenUnlocked(plugin);
    return;
  }
  await revealSessionsSidebar(plugin);
}
