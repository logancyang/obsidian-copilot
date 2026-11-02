import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { leaveDeletedProject } from "@/agentMode/ui/AgentProjectRowActions";
import { ArchivedChatsModal, createProjectArchiveActions } from "@/agentMode/ui/ArchivedChatsModal";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useStoredIdSet } from "@/agentMode/ui/hooks/useStoredIdSet";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { SessionsSidebarPanel } from "@/agentMode/ui/SessionsSidebarPanel";
import { AGENT_CHAT_MODE } from "@/constants";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useActiveProjects, useArchivedProjects } from "@/projects/state";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface SessionsSidebarProps {
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
}

export const SessionsSidebar: React.FC<SessionsSidebarProps> = ({ manager, plugin }) => {
  const {
    chatHistoryItems,
    archivedChatItems,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    setChatPinned,
    setChatArchived,
    openSourceFile,
    copyChatLink,
    getChatBookmarkState,
    setChatBookmarked,
  } = useAgentHistoryControls(manager, plugin);
  const { app } = plugin;
  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const waitingChatIds = useManagerSetSnapshot(manager, (m) => m.getWaitingChatIds());
  const attentionChatIds = useAttentionChatIds(manager);
  const activeChatIds = useManagerSetSnapshot(manager, (m) => m.getActiveChatIds());
  const subscribeToManager = useCallback((l: () => void) => manager.subscribe(l), [manager]);
  const getHistoryRevision = useCallback(() => manager.getHistoryRevision(), [manager]);
  const historyRevision = useSyncExternalStore(subscribeToManager, getHistoryRevision);
  const archivedProjects = useArchivedProjects();
  const archivedProjectKey = archivedProjects.map((project) => project.id).join("\n");
  const projects = useActiveProjects();
  const { ids: expandedProjectIds, toggle: toggleProject } = useStoredIdSet(
    app,
    "copilot:sessions-sidebar-expanded-projects:v1"
  );
  const { ids: collapsedGroups, toggle: toggleGroup } = useStoredIdSet(
    app,
    "copilot:sessions-sidebar-collapsed-groups:v1"
  );

  // The saved list changes when a chat starts, finishes, is renamed or deleted, or when a project's archive state changes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory, openChatIds, runningChatIds, archivedProjectKey, historyRevision]);

  // Pins, archives and note renames made in the landing lists land in the chat note's frontmatter, and a reload
  // before Obsidian re-reads that note would still list the old state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  useEffect(() => {
    const ref = plugin.app.metadataCache.on("changed", (_file, _data, cache) => {
      if (cache.frontmatter?.mode === AGENT_CHAT_MODE) void loadChatHistory();
    });
    return () => plugin.app.metadataCache.offref(ref);
  }, [plugin, loadChatHistory]);

  const handleNewChat = useCallback(async () => {
    try {
      await plugin.activateAgentView();
      await manager.openGlobalLanding();
    } catch (e) {
      logError("[AgentMode] sidebar new chat failed", e);
      new Notice("Failed to start a new chat. Please try again.");
    }
  }, [manager, plugin]);

  const handleCloseSession = useCallback(
    async (id: string) => {
      try {
        await manager.closeChatSession(id);
      } catch (error) {
        logError("[AgentMode] close chat session failed", error);
        new Notice(
          `Could not close chat: ${error instanceof Error ? error.message : "Try again."}`
        );
      }
    },
    [manager]
  );

  const actions = useMemo<RecentChatActions>(
    () => ({
      onUpdateTitle: updateChatTitle,
      onCopyChatLink: copyChatLink,
      getChatBookmarkState,
      onSetChatBookmarked: setChatBookmarked,
      onDeleteChat: deleteChat,
      onOpenSourceFile: (id) => void openSourceFile(id),
      onCloseSession: handleCloseSession,
      onSetChatPinned: setChatPinned,
      onSetChatArchived: setChatArchived,
    }),
    [
      updateChatTitle,
      copyChatLink,
      getChatBookmarkState,
      setChatBookmarked,
      deleteChat,
      openSourceFile,
      handleCloseSession,
      setChatPinned,
      setChatArchived,
    ]
  );

  const handleViewArchived = useCallback(() => {
    const projectActions = createProjectArchiveActions(app, manager);
    new ArchivedChatsModal(app, archivedChatItems, archivedProjects, {
      onUnarchive: (id) => setChatArchived(id, false),
      onOpen: loadChat,
      ...projectActions,
      onOpenProject: async (id) => {
        await plugin.activateAgentView();
        await projectActions.onOpenProject(id);
      },
    }).open();
  }, [app, plugin, manager, archivedChatItems, archivedProjects, setChatArchived, loadChat]);

  const handleProjectDeleted = useCallback(
    (deletedId: string) => leaveDeletedProject(manager, deletedId),
    [manager]
  );

  return (
    <SessionsSidebarPanel
      items={chatHistoryItems}
      projects={projects}
      expandedProjectIds={expandedProjectIds}
      openChatIds={openChatIds}
      actions={actions}
      onToggleProject={toggleProject}
      collapsedGroups={collapsedGroups}
      onToggleGroup={toggleGroup}
      onProjectDeleted={handleProjectDeleted}
      onViewArchived={handleViewArchived}
      activeChatIds={activeChatIds}
      runningChatIds={runningChatIds}
      waitingChatIds={waitingChatIds}
      attentionChatIds={attentionChatIds}
      onNewChat={safeAsyncHandler(handleNewChat)}
      onOpenChat={safeAsyncHandler(loadChat)}
    />
  );
};
