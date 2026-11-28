import { isSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { subscribeToEntitlementChange } from "@/plusUtils";
import type { Plugin } from "obsidian";

export function trackTabStripShown(plugin: Plugin, manager: AgentSessionManager): void {
  const { app } = plugin;
  // The tab strip holds its chats while any Agent Chat leaf is open and the Navigator is not covering it; a React mount would let go whenever Agent Chat briefly shows a setup screen or moves to another window.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/849
  const sync = () =>
    manager.setTabStripShown(
      app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).length > 0 && !isSessionsSidebarOpen(app)
    );
  plugin.registerEvent(app.workspace.on("layout-change", sync));
  plugin.register(subscribeToEntitlementChange(sync));
  app.workspace.onLayoutReady(sync);
}
