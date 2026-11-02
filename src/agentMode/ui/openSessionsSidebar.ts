import { NavigatorUpsellModal } from "@/agentMode/ui/NavigatorUpsell";
import type CopilotPlugin from "@/main";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";

const pluginsAwaitingPlus = new WeakSet<CopilotPlugin>();

export function openNavigatorWhenPlusActivates(plugin: CopilotPlugin): void {
  // A user who buys Plus from a Navigator prompt lands in the Navigator without finding its icon again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (pluginsAwaitingPlus.has(plugin)) return;
  pluginsAwaitingPlus.add(plugin);
  const unsubscribe = subscribeToSettingsChange((prev, next) => {
    if (prev.isPaidUser === true || next.isPaidUser !== true) return;
    unsubscribe();
    pluginsAwaitingPlus.delete(plugin);
    void plugin.activateSessionsSidebar();
  });
  plugin.register(unsubscribe);
}

export async function openSessionsSidebar(plugin: CopilotPlugin): Promise<void> {
  // The tab-strip icon stays clickable without Plus and explains the upgrade instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/813
  if (getSettings().isPaidUser === false) {
    new NavigatorUpsellModal(plugin.app).open();
    openNavigatorWhenPlusActivates(plugin);
    return;
  }
  await plugin.activateSessionsSidebar();
}
