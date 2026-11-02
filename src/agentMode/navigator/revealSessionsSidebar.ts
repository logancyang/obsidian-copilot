import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";

export async function revealSessionsSidebar(plugin: CopilotPlugin): Promise<void> {
  // The Navigator lists Agent Mode sessions, so it waits for Agent Mode to finish starting.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  if (!plugin.agentSessionManager) {
    new Notice("Agent Chat is not initialized.");
    return;
  }
  const { workspace } = plugin.app;
  const [existing] = workspace.getLeavesOfType(SESSIONS_SIDEBAR_VIEWTYPE);
  const leaf = existing ?? workspace.getLeftLeaf(false);
  if (!leaf) return;
  if (!existing) await leaf.setViewState({ type: SESSIONS_SIDEBAR_VIEWTYPE, active: true });
  workspace.revealLeaf(leaf);
}
