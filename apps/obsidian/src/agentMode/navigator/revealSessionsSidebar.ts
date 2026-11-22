import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type { CopilotHost } from "@/host/platform/copilotHost";
import { Notice } from "obsidian";

export interface SessionsSidebarHost extends Pick<CopilotHost, "app"> {
  readonly agentSessionManager?: AgentSessionManager;
}

export async function revealSessionsSidebar(host: SessionsSidebarHost): Promise<void> {
  // The Navigator lists Agent Mode sessions, so it waits for Agent Mode to finish starting.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  if (!host.agentSessionManager) {
    new Notice("Copilot Chat is not initialized.");
    return;
  }
  const { workspace } = host.app;
  const [existing] = workspace.getLeavesOfType(SESSIONS_SIDEBAR_VIEWTYPE);
  const leaf = existing ?? workspace.getLeftLeaf(false);
  if (!leaf) return;
  if (!existing) await leaf.setViewState({ type: SESSIONS_SIDEBAR_VIEWTYPE, active: true });
  workspace.revealLeaf(leaf);
}
