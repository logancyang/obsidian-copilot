import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { RecentChatActions } from "@/agentMode/ui/RecentChatMenu";
import { createProjectAndEnter } from "@/agentMode/ui/AgentProjectCreateForm";
import { leaveDeletedProject } from "@/agentMode/ui/AgentProjectRowActions";
import { ArchivedChatsModal, createProjectArchiveActions } from "@/agentMode/ui/ArchivedChatsModal";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useStoredIdSet } from "@/hooks/useStoredIdSet";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { SessionsSidebarPanel } from "@/agentMode/navigator/ui/SessionsSidebarPanel";
import { AGENT_CHAT_MODE } from "@/constants";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useActiveProjects, useArchivedProjects } from "@/projects/state";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { debounce } from "@/utils/debounce";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface SessionsSidebarProps {
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
}

// Browsing chats in the Navigator never leaves a session behind, so each move away releases a chat with no message sent; tabs only release on close.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/849
function releasingLeftChat<A extends unknown[]>(
  manager: AgentSessionManager,
  navigate: (...args: A) => Promise<void>
): (...args: A) => Promise<void> {
  return async (...args) => {
    const left = manager.getActiveSession()?.internalId;
    await navigate(...args);
    if (left) manager.closeSessionIfLeft(left);
  };
}

export const SessionsSidebar: React.FC<SessionsSidebarProps> = ({ manager, plugin }) => {
  const {
    chatHistoryItems,
    archivedChatItems,
    loadChatHistory,
    loadChat: loadChatInView,
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
  const loadChat = useMemo(
    () => releasingLeftChat(manager, loadChatInView),
    [manager, loadChatInView]
  );
  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const waitingChatIds = useManagerSetSnapshot(manager, (m) => m.getWaitingChatIds());
  const attentionChatIds = useAttentionChatIds(manager);
  const activeChatIds = useManagerSetSnapshot(manager, (m) => m.getActiveChatIds());
  const subscribeToManager = useCallback((l: () => void) => manager.subscribe(l), [manager]);
  const getHistoryRevision = useCallback(() => manager.getHistoryRevision(), [manager]);
  const historyRevision = useSyncExternalStore(subscribeToManager, getHistoryRevision);
  const getActiveProjectId = useCallback(() => manager.getActiveProjectId(), [manager]);
  const activeProjectId = useSyncExternalStore(subscribeToManager, getActiveProjectId);
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
  const { ids: projectOrder, replace: reorderProjects } = useStoredIdSet(
    app,
    "copilot:sessions-sidebar-project-order:v1"
  );

  // The saved list changes when a chat starts, finishes, is renamed or deleted, or when a project's archive state changes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory, openChatIds, runningChatIds, archivedProjectKey, historyRevision]);

  // Pins, archives and note renames made in the landing lists land in the chat note's frontmatter, and a reload
  // before Obsidian re-reads that note would still list the old state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/801
  // A burst of chat notes (a Sync download) reloads once, not once per note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/808
  useEffect(() => {
    const reload = debounce(() => void loadChatHistory(), 500, { leading: true });
    const ref = plugin.app.metadataCache.on("changed", (_file, _data, cache) => {
      if (cache.frontmatter?.mode === AGENT_CHAT_MODE) reload();
    });
    return () => {
      plugin.app.metadataCache.offref(ref);
      reload.cancel();
    };
  }, [plugin, loadChatHistory]);

  const handleNewChat = useMemo(
    () =>
      releasingLeftChat(manager, async () => {
        try {
          await manager.openGlobalLanding();
          await plugin.activateAgentView();
        } catch (e) {
          logError("[AgentMode] sidebar new chat failed", e);
          new Notice("Failed to start a new chat. Please try again.");
        }
      }),
    [manager, plugin]
  );

  const handleOpenProject = useMemo(
    () =>
      releasingLeftChat(manager, async (projectId: string) => {
        try {
          await manager.openProjectLanding(projectId);
          await plugin.activateAgentView();
        } catch (e) {
          logError("[AgentMode] sidebar open project failed", e);
          new Notice("Failed to open project. Please try again.");
        }
      }),
    [manager, plugin]
  );

  const handleCreateProject = useMemo(
    () =>
      releasingLeftChat(manager, async (name: string) => {
        await createProjectAndEnter(app, manager, name);
        await plugin.activateAgentView();
      }),
    [app, manager, plugin]
  );

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
      onOpenProject: releasingLeftChat(manager, async (id: string) => {
        await projectActions.onOpenProject(id);
        await plugin.activateAgentView();
      }),
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
      projectOrder={projectOrder}
      activeProjectId={activeProjectId}
      openChatIds={openChatIds}
      actions={actions}
      onToggleProject={toggleProject}
      onReorderProjects={reorderProjects}
      onOpenProject={safeAsyncHandler(handleOpenProject)}
      onCreateProject={handleCreateProject}
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
