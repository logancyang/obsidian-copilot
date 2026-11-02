import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import type CopilotPlugin from "@/main";
import { isPreviewEnabled, subscribeToPreviewAccess } from "@/plusUtils";

const pluginsAwaitingPreview = new WeakSet<CopilotPlugin>();

export function openNavigatorWhenPreviewActivates(plugin: CopilotPlugin): void {
  // A Supporter who unlocks preview from a Navigator prompt lands in the Navigator without finding its icon again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (pluginsAwaitingPreview.has(plugin)) return;
  pluginsAwaitingPreview.add(plugin);
  const unsubscribe = subscribeToPreviewAccess(() => {
    if (isPreviewEnabled() !== true) return;
    unsubscribe();
    pluginsAwaitingPreview.delete(plugin);
    void plugin.activateSessionsSidebar();
  });
  plugin.register(unsubscribe);
}

export async function openSessionsSidebar(plugin: CopilotPlugin): Promise<void> {
  // The Navigator is a Supporter preview; its entry points stay visible and explain it instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  if (isPreviewEnabled() === false) {
    new NavigatorUpsellModal(plugin.app).open();
    openNavigatorWhenPreviewActivates(plugin);
    return;
  }
  await plugin.activateSessionsSidebar();
}
