import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { SessionsSidebarPanel } from "@/agentMode/ui/SessionsSidebarPanel";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useArchivedProjects } from "@/projects/state";
import { Notice } from "obsidian";
import React, { useCallback, useEffect } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface SessionsSidebarProps {
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
}

export const SessionsSidebar: React.FC<SessionsSidebarProps> = ({ manager, plugin }) => {
  const { chatHistoryItems, loadChatHistory, loadChat } = useAgentHistoryControls(manager, plugin);
  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const waitingChatIds = useManagerSetSnapshot(manager, (m) => m.getWaitingChatIds());
  const attentionChatIds = useAttentionChatIds(manager);
  const activeChatIds = useManagerSetSnapshot(manager, (m) => m.getActiveChatIds());
  const archivedProjectKey = useArchivedProjects()
    .map((project) => project.id)
    .join("\n");

  // The saved list changes when a chat starts, finishes, or when a project's archive state changes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory, openChatIds, runningChatIds, archivedProjectKey]);

  const handleNewChat = useCallback(async () => {
    try {
      await plugin.activateAgentView();
      await manager.openGlobalLanding();
    } catch (e) {
      logError("[AgentMode] sidebar new chat failed", e);
      new Notice("Failed to start a new chat. Please try again.");
    }
  }, [manager, plugin]);

  return (
    <SessionsSidebarPanel
      items={chatHistoryItems}
      activeChatIds={activeChatIds}
      runningChatIds={runningChatIds}
      waitingChatIds={waitingChatIds}
      attentionChatIds={attentionChatIds}
      onNewChat={safeAsyncHandler(handleNewChat)}
      onOpenChat={safeAsyncHandler(loadChat)}
    />
  );
};
