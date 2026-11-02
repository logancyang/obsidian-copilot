import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";

export async function openSessionsSidebar(plugin: CopilotPlugin): Promise<void> {
  // The tab-strip icon stays clickable without Plus and explains the upgrade instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/813
  if (getSettings().isPaidUser === false) {
    new NavigatorUpsellModal(plugin.app).open();
    return;
  }
  await plugin.activateSessionsSidebar();
}
