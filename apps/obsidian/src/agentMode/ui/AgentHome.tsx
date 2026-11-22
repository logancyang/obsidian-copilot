import { useChatRelevantNotesContext } from "@/agentMode/ui/hooks/useChatRelevantNotesContext";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import { openReportIssueModal } from "@/agentMode/ui/ReportIssueModal";
import { formatChatReportNote } from "@/agentMode/session/feedback/feedbackOffer";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { CreateProjectPanel } from "@/projects/ui/CreateProjectPanel";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { ConnectorsAttentionBanner } from "@/agentMode/ui/ConnectorsAttentionBanner";
import { AgentProjectHeader } from "@/projects/ui/AgentProjectHeader";
import { ProjectFilesView } from "@/projects/ui/ProjectFilesView";
import { ProjectInfoPopover } from "@/projects/ui/ProjectInfoPopover";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { TaskDetailView } from "@/agentMode/ui/TaskDetailView";
import { runningTasks, taskDisplayStatus } from "@/agentMode/ui/taskDisplay";
import { AgentHomeReleaseUpdate } from "@/components/release-update/AgentHomeReleaseUpdate";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import {
  nextProjectLandingPlacement,
  type ProjectLandingPlacement,
} from "@/projects/projectLandingPlacement";
import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { ArchivedChatsModal, createProjectArchiveActions } from "@/agentMode/ui/ArchivedChatsModal";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import {
  useHomeShelfTab,
  HOME_SHELF_TAB_STORAGE_KEY,
  PROJECT_SHELF_TAB_STORAGE_KEY,
} from "@/agentMode/ui/homeShelfPrefs";
import { leaveDeletedProject, projectRowActions } from "@/projects/ui/AgentProjectRowActions";
import { ProjectPickerList } from "@/projects/ui/ProjectPickerList";
import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { useRelevantNotesPaneOpen } from "@/agentMode/ui/useRelevantNotesPaneOpen";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { openSessionsSidebar } from "@/agentMode/navigator/openSessionsSidebar";
import { useSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useIsChatArchived } from "@/agentMode/ui/hooks/useIsChatArchived";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { useChatInputAutoFocus } from "@/agentMode/ui/hooks/useChatInputAutoFocus";
import { useComposerFocusAfterLandingSend } from "@/agentMode/ui/hooks/useComposerFocusAfterLandingSend";
import { useComposerFocusAfterTaskView } from "@/agentMode/ui/hooks/useComposerFocusAfterTaskView";
import { useRefreshEmptyLandingOnContextSourceChange } from "@/projects/hooks/useRefreshEmptyLandingOnContextSourceChange";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { pickRandomGreeting } from "@/agentMode/ui/landingGreetings";
import { backendRegistry, listBackendDescriptors } from "@/agentMode/backends/registry";
import { buildAgentModelChoices } from "@/agentMode/ui/agentModelPickerHelpers";
import {
  agentBackend,
  agentSetupReason,
  agentToSetUpBeforeChat,
  startCustomAgentChat,
} from "@/agents/agentMode/agentChats";
import { AgentProfile } from "@/agents/agentMode/ui/AgentProfile";
import { findRun } from "@/agents/agentMode/agentRelays";
import { ChatAskedAgentView } from "@/agents/agentMode/ui/AskedAgentView";
import { chatRunningAgents } from "@/agents/agentMode/ui/RunningAgents";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { AgentIdentityBar } from "@/agents/ui/AgentIdentityBar";
import {
  ChatAgentsContext,
  ChatRunsContext,
  useChatAgentsValue,
  type RunRef,
} from "@/agents/ui/chatAgents";
import { AgentProfileCover, useAgentProfileRoute } from "@/agents/ui/AgentProfileCover";
import { AgentRoster } from "@/agents/ui/AgentRoster";
import { CreateAgentModal } from "@/agents/ui/CreateAgentModal";
import {
  dismissFirstAgentBanner,
  FirstAgentBanner,
  useFirstAgentBannerVisible,
} from "@/agents/ui/FirstAgentBanner";
import {
  LockedAgentChat,
  LockedHomeNote,
  unlockCustomAgents,
  useReadOnlyChatAgent,
} from "@/agents/ui/LockedAgentNotices";
import { openLockedAgentProfile, renderNewAgentButton } from "@/agents/ui/lockedCustomAgents";
import { agentComposerHint, useAgentHomeSelection } from "@/agents/ui/useAgentHomeSelection";
import { CustomAgentStoreContext, useCustomAgents } from "@/agents/ui/useCustomAgents";
import { useAgentSetupProblems } from "@/agents/agentMode/useAgentSetupProblems";
import { useAgentRecentChats } from "@/agents/ui/useAgentRecentChats";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { type ProjectConfig } from "@/aiParams";
import { createProjectAndEnter } from "@/projects/ui/AgentProjectCreateForm";
import { TruncatedText } from "@/components/TruncatedText";
import { AppContext } from "@/context";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectLandingCaptureSignature } from "@/projects/projectContextSignature";
import { getProjectFolderPath } from "@/projects/projectPaths";
import {
  getCachedProjectRecordById,
  useActiveProjects,
  useArchivedProjects,
  useProjects,
} from "@/projects/state";
import { getSettings, useSettingsValue } from "@/settings/model";
import { FileSearch, Files, Folder, MessageSquare } from "lucide-react";
import { Notice } from "obsidian";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentHomeProps {
  backend: AgentChatBackend;
  sessionId: string;
  chatInputId: string;
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
  customAgents: CustomAgentStore | undefined;
  hiddenAgentChats: HiddenAgentChats | undefined;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

const EMPTY_PROJECT_NAMES_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

const AgentHomeInternal: React.FC<AgentHomeProps> = ({
  backend,
  sessionId,
  chatInputId,
  manager,
  plugin,
  customAgents,
  hiddenAgentChats,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;
  const settings = useSettingsValue();
  const isRelevantNotesPaneOpen = useRelevantNotesPaneOpen(app);
  const draft = useAgentInputDrafts({ store: manager.drafts, chatInputId });

  useChatInputAutoFocus();

  const {
    messages,
    isStarting,
    isTurnInFlight,
    hasPendingPlanPermission,
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatStates,
    queuedPrompts,
    tasks,
    isReplyRunning,
  } = useAgentChatRuntimeState(backend);
  const isLoading = draft.loading || isTurnInFlight;
  const replyRunning = draft.loading || isReplyRunning;

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [openedTask, setOpenedTask] = useState<{ sessionId: string; toolCallId: string } | null>(
    null
  );
  const handleOpenTask = useCallback(
    (toolCallId: string) => setOpenedTask({ sessionId, toolCallId }),
    [sessionId]
  );
  const handleStopTask = useCallback(
    (taskId: string) => {
      backend.stopTask(taskId).catch((e: unknown) => logWarn("[AgentMode] stop task failed", e));
    },
    [backend]
  );
  const detailTask =
    openedTask?.sessionId === sessionId
      ? tasks.find((task) => task.toolCallId === openedTask.toolCallId)
      : undefined;
  const [openedRun, setOpenedRun] = useState<{ sessionId: string; run: RunRef } | null>(null);
  const handleOpenRun = useCallback((run: RunRef) => setOpenedRun({ sessionId, run }), [sessionId]);
  const detailRun =
    openedRun?.sessionId === sessionId ? findRun(messages, openedRun.run) : undefined;
  const hasRun = useCallback((run: RunRef) => findRun(messages, run) !== undefined, [messages]);
  const detailOpen = detailTask !== undefined || detailRun !== undefined;
  const markTaskViewClosedByUser = useComposerFocusAfterTaskView(detailOpen);
  const handleCloseTask = useCallback(() => {
    markTaskViewClosedByUser();
    setOpenedTask(null);
    setOpenedRun(null);
  }, [markTaskViewClosedByUser]);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onSaveChat(async () => {
      await manager.saveActiveSession();
    });
  }, [onSaveChat, manager]);

  const handleSaveAsNote = useCallback(async () => {
    try {
      const result = await manager.saveActiveSession();
      if (result) {
        new Notice("Chat saved as note.");
      } else {
        new Notice("Nothing to save yet.");
      }
    } catch (error) {
      logError("[AgentMode] manual save failed", error);
      new Notice("Failed to save chat as note. Check the Copilot log for details.");
    }
  }, [manager]);

  const handleNewChat = useCallback(() => {
    if (manager.getIsStarting()) return;
    const active = manager.getActiveSession();
    if (!active || !active.hasUserVisibleMessages()) return;
    const oldId = active.internalId;
    void (async () => {
      try {
        await manager.startNewChatInPlace(oldId, active.backendId);
      } catch (e) {
        logError("[AgentMode] new chat failed", e);
        new Notice("Failed to start a new chat. Please try again.");
      }
    })();
  }, [manager]);

  const handleContinueFrom = useCallback(
    (messageId: string) =>
      manager.continueChatFrom(sessionId, messageId).catch((e) => {
        logError("[AgentMode] continue in a new chat failed", e);
        new Notice("Failed to continue in a new chat. Please try again.");
      }),
    [manager, sessionId]
  );

  const descriptor = useSessionBackendDescriptor(manager);
  const handleInstall = useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  const projects = useProjects();
  const activeProjects = useActiveProjects();
  const archivedProjects = useArchivedProjects();
  const archivedProjectKey = archivedProjects.map((project) => project.id).join("\n");
  const projectNamesById = useMemo<Readonly<Record<string, string>>>(() => {
    if (projects.length === 0) return EMPTY_PROJECT_NAMES_BY_ID;
    return Object.fromEntries(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const projectUsageManager = useMemo(
    () => ProjectFileManager.getInstance(app).getProjectUsageTimestampsManager(),
    [app]
  );

  const activeProjectId = manager.getActiveProjectId();
  const isProjectScope = activeProjectId !== GLOBAL_SCOPE;
  const activeProject = isProjectScope ? projects.find((p) => p.id === activeProjectId) : undefined;
  const isOrphanedProject = isProjectScope && !activeProject;
  const activeProjectRecord = isProjectScope ? getCachedProjectRecordById(activeProjectId) : null;
  const projectFolderPath = activeProjectRecord
    ? getProjectFolderPath(activeProjectRecord.folderName)
    : undefined;
  const projectName = activeProject?.name ?? "";
  const lastProjectHeaderRef = useRef({
    name: projectName,
    orphaned: isOrphanedProject,
  });
  if (isProjectScope) {
    lastProjectHeaderRef.current = {
      name: projectName,
      orphaned: isOrphanedProject,
    };
  }
  const headerName = isProjectScope ? projectName : lastProjectHeaderRef.current.name;
  const headerOrphaned = isProjectScope ? isOrphanedProject : lastProjectHeaderRef.current.orphaned;

  const {
    chatHistoryItems,
    archivedChatItems,
    chatHistorySettled,
    loadChatHistory: handleLoadChatHistory,
    loadChat: handleLoadChat,
    updateChatTitle: handleUpdateChatTitle,
    deleteChat: handleDeleteChat,
    deleteChats: handleDeleteChats,
    setChatPinned: handleSetChatPinned,
    setChatArchived: handleSetChatArchived,
    setActiveChatArchived: handleSetActiveChatArchived,
    archiveChats: handleArchiveChats,
    openSourceFile: handleOpenSourceFile,
    copyChatLink: handleCopyHistoryChatLink,
    getChatBookmarkState,
    setChatBookmarked: handleSetChatBookmarked,
    setActiveChatBookmarked: handleSetActiveChatBookmarked,
  } = useAgentHistoryControls(manager, plugin, activeProjectId);

  const handleCloseSession = useCallback(
    async (id: string) => {
      try {
        await manager.closeChatSession(id);
      } catch (error) {
        logError("[AgentMode] close chat session failed", error);
        new Notice(
          `Could not shut down chat: ${error instanceof Error ? error.message : "Try again."}`
        );
      }
    },
    [manager]
  );

  const handleLoadChatHistorySafely = safeAsyncHandler(handleLoadChatHistory);

  const handleViewArchived = useCallback(
    () =>
      new ArchivedChatsModal(app, archivedChatItems, isProjectScope ? [] : archivedProjects, {
        onUnarchive: (id) => handleSetChatArchived(id, false),
        onOpen: handleLoadChat,
        ...createProjectArchiveActions(app, manager),
      }).open(),
    [
      app,
      manager,
      isProjectScope,
      archivedChatItems,
      archivedProjects,
      handleSetChatArchived,
      handleLoadChat,
    ]
  );

  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const attentionChatIds = useAttentionChatIds(manager);

  const handleOpenSessionsSidebar = useCallback(() => {
    openSessionsSidebar(plugin).catch((e) => logError("[AgentMode] open sidebar failed", e));
  }, [plugin]);

  const navigatorOpen = useSessionsSidebarOpen(app);

  const handleExitProject = useCallback(() => {
    manager.exitProject().catch((e) => {
      logError("[AgentMode] exit project failed", e);
      new Notice("Failed to leave project. Please try again.");
    });
  }, [manager]);

  const handleOpenProjectHome = useCallback(() => {
    manager.openProjectLanding(manager.getActiveProjectId()).catch((e) => {
      logError("[AgentMode] open project home failed", e);
      new Notice("Failed to open project. Please try again.");
    });
  }, [manager]);

  const handleProjectDeleted = useCallback(
    (deletedId: string) => leaveDeletedProject(manager, deletedId),
    [manager]
  );

  const handleSelectProject = useCallback(
    (project: ProjectConfig) => {
      manager.enterProject(project.id).catch((e) => {
        logError("[AgentMode] enter project failed", e);
        new Notice("Failed to open project. Please try again.");
      });
    },
    [manager]
  );

  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
  const handleCreateProject = useCallback((anchorEl: HTMLElement) => {
    setCreateAnchor(anchorEl);
  }, []);

  const persistCreateProject = useCallback(
    async ({ name }: { name: string }) => {
      await createProjectAndEnter(app, manager, name);
      setCreateAnchor(null);
    },
    [app, manager]
  );

  useEffect(() => {
    if (isOrphanedProject) new Notice("This project no longer exists.");
  }, [isOrphanedProject]);

  const modelPickerOverride = useAgentModelPicker(manager, plugin);
  const modePickerOverride = useAgentModePicker(manager);

  const handleCycleMode = useCallback(() => {
    if (!modePickerOverride || modePickerOverride.disabled) return;
    const { options, value, onChange } = modePickerOverride;
    if (options.length === 0) return;
    const currentIdx = options.findIndex((o) => o.value === value);
    const next = options[(currentIdx + 1) % options.length];
    if (next.value !== value) onChange(next.value);
  }, [modePickerOverride]);

  useChatRelevantNotesContext(app, rootEl, chatInputId, draft, messages, activeProject);

  const { setContextFolders } = draft;
  const addContextFolders = useCallback(
    (folderPaths: string[]) =>
      setContextFolders((previous) => [...new Set([...previous, ...folderPaths])]),
    [setContextFolders]
  );

  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: draft.contextNotes,
    setContextNotes: draft.setContextNotes,
    selectedImages: draft.images,
    onAddImage: draft.addImages,
    containerRef: chatContainerRef,
    acceptAnyFileType: true,
    projectFolderPath,
    onAddFolders: addContextFolders,
  });

  const isLanding = !manager.getActiveSession()?.hasUserVisibleMessages();
  const isProjectLanding = isLanding && isProjectScope;
  useComposerFocusAfterLandingSend(sessionId, isLanding);

  const switchLandingAgent = useCallback(
    async (agent: CustomAgent | null) => {
      const landing = manager.getActiveSession();
      if (!landing) return;
      const { backendId, seed } = agent ? agentBackend(manager, agent) : {};
      const chat = await manager.replaceSessionInPlace(landing.internalId, backendId, {
        seedSelection: seed,
        agentSlug: agent?.slug ?? null,
      });
      await chat.ready;
    },
    [manager]
  );
  const needsSetup = useAgentSetupProblems(plugin, useCustomAgents(customAgents));
  const agentHome = useAgentHomeSelection(
    customAgents,
    {
      sessionId,
      chatInputId,
      agentSlug: manager.getSession(sessionId)?.agentSlug ?? null,
      isLanding,
    },
    switchLandingAgent,
    needsSetup
  );
  const recentChats = useAgentRecentChats(chatHistoryItems, agentHome.agents, agentHome.selected);
  const customAgentsGate = useCustomAgentsGate();
  const { focusInput, insertTextWithPills } = useChatInput();
  const selectAgent = agentHome.select;
  const getAgentModelChoices = useCallback(
    () =>
      buildAgentModelChoices({
        manager,
        descriptors: listBackendDescriptors(),
        settings: getSettings(),
      }),
    [manager]
  );
  const openCreateAgentDialog = useCallback(() => {
    if (!customAgents) return;
    new CreateAgentModal(app, {
      store: customAgents,
      models: getAgentModelChoices(),
      onCreated: (slug) => void selectAgent(slug).then(focusInput),
      onAskCopilot: (message) =>
        void selectAgent(null).then(() => {
          focusInput();
          insertTextWithPills(message);
        }),
    }).open();
  }, [app, customAgents, getAgentModelChoices, selectAgent, focusInput, insertTextWithPills]);
  const newAgentButton = renderNewAgentButton(customAgentsGate, {
    emphasized: agentHome.agents.length === 0,
    onCreate: openCreateAgentDialog,
  });
  const firstAgentBannerVisible = useFirstAgentBannerVisible(agentHome.agents.length);
  // A new chat rebuilt in place, as when the agent's model changes from this profile, keeps its chat input, so the profile stays open over it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  const profile = useAgentProfileRoute(agentHome.agents, chatInputId);
  const markProfileClosedByUser = useComposerFocusAfterTaskView(profile.agent !== null);
  const { close: closeProfile, open: openProfile } = profile;
  const chatAgents = useChatAgentsValue(customAgents, agentHome.selected?.slug ?? null, {
    openRun: handleOpenRun,
    needsSetup,
    openProfile,
  });
  const openLockedProfile = useCallback(
    (slug: string) => void openLockedAgentProfile(app, () => openProfile(slug)),
    [app, openProfile]
  );
  const openSavedChat = useCallback(
    async (id: string) => {
      const chat = chatHistoryItems.find((item) => item.id === id);
      const slug = chat && agentToSetUpBeforeChat(chat, needsSetup);
      if (slug) openProfile(slug);
      else await handleLoadChat(id);
    },
    [chatHistoryItems, needsSetup, openProfile, handleLoadChat]
  );
  const leaveProfile = useCallback(() => {
    markProfileClosedByUser();
    closeProfile();
  }, [markProfileClosedByUser, closeProfile]);
  const selectedSlug = agentHome.selected?.slug ?? null;
  const startChatFromProfile = useCallback(
    (agent: CustomAgent) => {
      // The new chat page already has the agent picked, so its new chat is that page.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
      // An agent unlocked from its profile was never picked, so the new chat page picks it now.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
      if (isLanding) {
        leaveProfile();
        if (selectedSlug !== agent.slug) void selectAgent(agent.slug);
        return;
      }
      startCustomAgentChat(manager, agent).catch((e: unknown) => {
        logError("[AgentMode] new chat from an agent's profile failed", e);
        new Notice(`Couldn't start a chat with ${agent.name}. Please try again.`);
      });
    },
    [isLanding, leaveProfile, selectedSlug, selectAgent, manager]
  );
  const dropOverlay = isDragActive && (
    <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
      <span>Drop files here...</span>
    </div>
  );

  const refreshContextForEmptyLanding = useCallback(async (): Promise<boolean> => {
    const active = manager.getActiveSession();
    if (!active || active.hasUserVisibleMessages()) return false;
    const draftEmpty =
      draft.input.trim() === "" &&
      draft.images.length === 0 &&
      draft.contextNotes.length === 0 &&
      draft.contextFolders.length === 0 &&
      draft.queue.length === 0;
    if (!draftEmpty) return false;
    try {
      await manager.replaceSessionInPlace(active.internalId, active.backendId);
      return true;
    } catch (e) {
      logError("[AgentMode] refresh landing context failed", e);
      return false;
    }
  }, [manager, draft]);

  const draftIsEmpty =
    draft.input.trim() === "" &&
    draft.images.length === 0 &&
    draft.contextNotes.length === 0 &&
    draft.contextFolders.length === 0 &&
    draft.queue.length === 0;
  const activeProjectLandingCaptureSignature = useMemo(() => {
    if (!isProjectScope) return null;
    const record = getCachedProjectRecordById(activeProjectId);
    return record ? getProjectLandingCaptureSignature(app, record) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projects intentionally re-derives metadata read through the project cache
  }, [app, isProjectScope, activeProjectId, projects]);
  useRefreshEmptyLandingOnContextSourceChange({
    activeProjectId,
    signature: activeProjectLandingCaptureSignature,
    isLanding,
    draftEmpty: draftIsEmpty,
    refresh: refreshContextForEmptyLanding,
  });

  const landingVisitKey = isProjectLanding ? `${activeProjectId}\0${sessionId}` : null;
  const placementRef = useRef<ProjectLandingPlacement | null>(null);
  placementRef.current = nextProjectLandingPlacement(placementRef.current, landingVisitKey, {
    settled: chatHistorySettled,
    chatCount: chatHistoryItems.length,
    archivedChatCount: archivedChatItems.length,
  });
  const projectPlacement = placementRef.current;
  const isProjectContextInline = projectPlacement?.standalone === true;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId intentionally re-rolls the otherwise argument-free greeting factory
  const greeting = useMemo(() => pickRandomGreeting(), [sessionId]);

  useEffect(() => {
    if (isLanding) void handleLoadChatHistory();
  }, [isLanding, handleLoadChatHistory, archivedProjectKey]);

  const [globalShelfTab, setGlobalShelfTab] = useHomeShelfTab(app, HOME_SHELF_TAB_STORAGE_KEY);
  const [projectShelfTab, setProjectShelfTab] = useHomeShelfTab(app, PROJECT_SHELF_TAB_STORAGE_KEY);

  const landingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent chats",
        renderBody: () => (
          <GlobalRecentChatsSection
            {...recentChats}
            onLoadChat={openSavedChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onOpenSourceFile={handleOpenSourceFile}
            onCopyChatLink={handleCopyHistoryChatLink}
            onSetChatPinned={handleSetChatPinned}
            onSetChatArchived={handleSetChatArchived}
            onDeleteChats={handleDeleteChats}
            onArchiveChats={handleArchiveChats}
            onViewArchived={handleViewArchived}
            getChatBookmarkState={getChatBookmarkState}
            onSetChatBookmarked={handleSetChatBookmarked}
            onLoadHistory={handleLoadChatHistorySafely}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
            projectNamesById={projectNamesById}
            sortStrategy={settings.chatHistorySortStrategy}
          />
        ),
      },
      ...(isRelevantNotesPaneOpen
        ? []
        : [
            {
              id: "relevant-notes",
              icon: <FileSearch className="tw-size-4" />,
              title: "Relevant Notes",
              renderBody: () => (
                <RelevantNotesShelfPanel onPopOut={() => void plugin.activateRelevantNotesView()}>
                  <RelevantNotes
                    className={cn("[&>[data-relevant-notes-empty-state]]:tw-py-6")}
                    onAddToChat={(note) => void plugin.addNoteToActiveChat(note)}
                  />
                </RelevantNotesShelfPanel>
              ),
            },
          ]),
      {
        id: "projects",
        icon: <Folder className="tw-size-4" />,
        title: "Projects",
        count: activeProjects.length,
        renderBody: () => (
          <ProjectPickerList
            projects={activeProjects}
            onSelect={handleSelectProject}
            onCreate={handleCreateProject}
            app={app}
            onProjectDeleted={handleProjectDeleted}
            projectUsageTimestampsManager={projectUsageManager}
          />
        ),
      },
    ],
    [
      activeProjects,
      projectNamesById,
      recentChats,
      app,
      projectUsageManager,
      handleSelectProject,
      handleCreateProject,
      handleProjectDeleted,
      openSavedChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleDeleteChats,
      handleArchiveChats,
      handleSetChatPinned,
      handleSetChatArchived,
      handleViewArchived,
      handleOpenSourceFile,
      handleCopyHistoryChatLink,
      getChatBookmarkState,
      handleSetChatBookmarked,
      handleLoadChatHistorySafely,
      openChatIds,
      handleCloseSession,
      runningChatIds,
      attentionChatIds,
      isRelevantNotesPaneOpen,
      plugin,
      settings.chatHistorySortStrategy,
    ]
  );

  const projectLandingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "project-files",
        icon: <Files className="tw-size-4" />,
        title: "Files",
        renderBody: () => <ProjectFilesView projectId={activeProjectId} canLink />,
      },
      {
        id: "project-chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent chats",
        renderBody: () => (
          <GlobalRecentChatsSection
            {...recentChats}
            variant="project"
            onLoadChat={openSavedChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onOpenSourceFile={handleOpenSourceFile}
            onCopyChatLink={handleCopyHistoryChatLink}
            onSetChatPinned={handleSetChatPinned}
            onSetChatArchived={handleSetChatArchived}
            onDeleteChats={handleDeleteChats}
            onArchiveChats={handleArchiveChats}
            onViewArchived={handleViewArchived}
            getChatBookmarkState={getChatBookmarkState}
            onSetChatBookmarked={handleSetChatBookmarked}
            onLoadHistory={handleLoadChatHistorySafely}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
            sortStrategy={settings.chatHistorySortStrategy}
          />
        ),
      },
    ],
    [
      recentChats,
      activeProjectId,
      openSavedChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleDeleteChats,
      handleArchiveChats,
      handleSetChatPinned,
      handleSetChatArchived,
      handleViewArchived,
      handleOpenSourceFile,
      handleCopyHistoryChatLink,
      getChatBookmarkState,
      handleSetChatBookmarked,
      handleLoadChatHistorySafely,
      openChatIds,
      handleCloseSession,
      runningChatIds,
      attentionChatIds,
      settings.chatHistorySortStrategy,
    ]
  );

  const projectShelfSections = useMemo(
    () =>
      isProjectContextInline
        ? projectLandingSections.filter((section) => section.id === "project-files")
        : projectLandingSections,
    [isProjectContextInline, projectLandingSections]
  );
  const showProjectShelf = isProjectContextInline ? !isOrphanedProject : projectPlacement !== null;

  const hasChatMovedFrom = useCallback(
    (from: AgentChatBackend) =>
      manager.getActiveSession()?.chatInputId === chatInputId &&
      manager.getActiveChatUIState() !== from,
    [manager, chatInputId]
  );

  const composerNode = (
    <ChatAgentsContext.Provider value={chatAgents}>
      <AgentChatInput
        backend={backend}
        chatInputId={chatInputId}
        draft={draft}
        app={app}
        updateUserMessageHistory={updateUserMessageHistory}
        // A message sent while a picked agent's chat is still starting would reach the chat it replaces, so it waits for the agent the home shows.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
        isStarting={isStarting || agentHome.switching}
        isLoading={isLoading}
        isReplyRunning={replyRunning}
        queuedPrompts={queuedPrompts}
        acceptsMidTurnMessages={backend.acceptsMidTurnMessages()}
        hasPendingPlanPermission={hasPendingPlanPermission}
        modelPickerOverride={modelPickerOverride ?? undefined}
        modePickerOverride={modePickerOverride ?? undefined}
        onCycleMode={handleCycleMode}
        disabled={isOrphanedProject}
        projectFolderPath={projectFolderPath}
        hasChatMovedFrom={hasChatMovedFrom}
        placeholder={agentComposerHint(agentHome.selected)}
      />
    </ChatAgentsContext.Provider>
  );

  const chatSetupProblem = agentHome.selected && needsSetup.get(agentHome.selected.slug);
  const lockedChatAgent = useReadOnlyChatAgent(agentHome.selected, isLoading, !!chatSetupProblem);

  const { queue: heldMessages, setQueue: setHeldMessages } = draft;
  const handleRemoveHeldMessage = useCallback(
    (id: string) => setHeldMessages((queue) => queue.filter((m) => m.id !== id)),
    [setHeldMessages]
  );
  const handleWithdrawMessage = useCallback(
    (id: string) => {
      backend.withdrawMessage(id).catch((e: unknown) => logError("[AgentMode] withdraw failed", e));
    },
    [backend]
  );
  const handleSendWaitingNow = useCallback(() => {
    backend.sendWaitingNow().catch((e: unknown) => logError("[AgentMode] send now failed", e));
  }, [backend]);
  // The controls bar sits directly above the composer, so pending messages list above both. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  const queuedMessagesNode =
    queuedPrompts.length > 0 || heldMessages.length > 0 ? (
      <QueuedMessageList
        delivering={queuedPrompts}
        held={heldMessages}
        onRemove={handleRemoveHeldMessage}
        onWithdraw={backend.canWithdrawMessages() ? handleWithdrawMessage : undefined}
        onSendNow={replyRunning ? handleSendWaitingNow : undefined}
      />
    ) : null;

  const showProjectHero = isProjectLanding && !isOrphanedProject;
  const heroText = showProjectHero ? `Chat in ${projectName}` : greeting;
  const hero = (
    <AgentRoster
      agents={agentHome.agents}
      selectedSlug={agentHome.selected?.slug ?? null}
      onSelect={(slug) => void agentHome.select(slug)}
      newAgentButton={newAgentButton}
      onOpenProfile={profile.open}
      needsSetup={needsSetup}
      locked={
        customAgentsGate === "locked"
          ? {
              onOpen: openLockedProfile,
              note: (
                <LockedHomeNote onUnlock={(ownerWindow) => unlockCustomAgents(app, ownerWindow)} />
              ),
            }
          : undefined
      }
      emptyHero={
        <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-center tw-gap-3">
          {!newAgentButton && <CopilotBrandIcon className="tw-size-6 tw-shrink-0 tw-text-normal" />}
          <TruncatedText
            className="tw-min-w-0 tw-text-3xl tw-font-[330] tw-text-normal"
            tooltipContent={heroText}
          >
            {heroText}
          </TruncatedText>
        </div>
      }
    />
  );

  const activeSession = manager.getSession(sessionId);
  const runningAgents = chatRunningAgents({
    messages,
    chat: activeSession,
    hiddenChats: hiddenAgentChats,
    agents: chatAgents.agents,
    taskCount: runningTasks(tasks).length,
    onOpen: (run) => handleOpenRun({ runId: run.id }),
    gate: customAgentsGate,
  });
  const getActiveChatBookmarkState = useCallback(
    () => getChatBookmarkState(manager.getSessionSourcePath(sessionId)),
    [getChatBookmarkState, manager, sessionId]
  );
  const activeSourcePath = manager.getSessionSourcePath(sessionId);
  const activeChatArchived = useIsChatArchived(activeSourcePath);
  const handleOpenChatNote = activeSourcePath
    ? () => handleOpenSourceFile(activeSourcePath)
    : undefined;
  const handleCopyChatLink = () =>
    plugin.copyChatLink(async () => {
      // A native session link only opens on this device: https://github.com/Brevilabs/obsidian-copilot-private/issues/601
      return (await manager.saveActiveSession())?.path ?? "";
    });

  const showHeader = isProjectScope;
  const headerProjectActions = activeProject
    ? projectRowActions({ app, project: activeProject })
    : undefined;
  const collapsibleHeaderRef = useRef<HTMLDivElement>(null);
  // The collapsed header stays mounted for its animation, so it is made inert to keep its buttons out of the tab order.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/804
  useEffect(() => {
    if (collapsibleHeaderRef.current) collapsibleHeaderRef.current.inert = !showHeader;
  }, [showHeader]);

  const handleReportError = () => {
    const evidence = activeSession?.getReportEvidence();
    openReportIssueModal(plugin, {
      activeBackend: evidence?.backendId ?? settings.agentMode.activeBackend,
      initialNote: evidence ? formatChatReportNote(evidence) : undefined,
      preselectAllSources: true,
    });
  };

  return (
    <div ref={setRootEl} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div
        className={cn(
          "tw-grid tw-shrink-0 tw-transition-[grid-template-rows,opacity] tw-duration-200 tw-ease-out motion-reduce:tw-transition-none",
          showHeader
            ? "tw-grid-rows-[1fr] tw-opacity-100"
            : "tw-pointer-events-none tw-grid-rows-[0fr] tw-opacity-0"
        )}
        aria-hidden={!showHeader}
        ref={collapsibleHeaderRef}
      >
        <div className="tw-min-h-0 tw-overflow-hidden">
          <AgentProjectHeader
            projectName={headerName}
            onOpenHome={handleOpenProjectHome}
            onExit={handleExitProject}
            orphaned={headerOrphaned}
            onOpenSettings={headerProjectActions?.edit}
            onRevealFolder={headerProjectActions?.reveal}
            isProjectHome={isProjectLanding}
            navigatorOpen={navigatorOpen}
            menu={
              activeProject ? (
                <ProjectInfoPopover
                  app={app}
                  project={activeProject}
                  messages={messages}
                  container={rootEl}
                />
              ) : undefined
            }
          />
        </div>
      </div>
      <AgentTabStrip
        manager={manager}
        onOpenSidebar={handleOpenSessionsSidebar}
        agents={agentHome.agents}
        onTabClick={profile.agent ? leaveProfile : undefined}
      />
      {createAnchor && (
        <CreateProjectPanel
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onSave={persistCreateProject}
        />
      )}
      <AgentProfileCover
        header={
          // A new chat's row of faces already shows who it is with; the bar takes over once the chat has a message.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/938
          // A task's or an asked agent's view names who it shows in its own header, which takes the bar's place.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/967
          !isLanding &&
          !detailOpen &&
          agentHome.selected && (
            <AgentIdentityBar agent={agentHome.selected} onOpenProfile={profile.open} />
          )
        }
        profile={
          profile.agent &&
          customAgents && (
            <AgentProfile
              agent={profile.agent}
              app={app}
              manager={manager}
              store={customAgents}
              hiddenChats={hiddenAgentChats}
              hostSessionId={sessionId}
              getModels={getAgentModelChoices}
              onBack={leaveProfile}
              onNewChat={startChatFromProfile}
              setupProblem={
                customAgentsGate === "full" ? needsSetup.get(profile.agent.slug) : undefined
              }
              onSetUp={(backendId) => backendRegistry[backendId].openInstallUI(plugin)}
            />
          )
        }
      >
        <div ref={chatContainerRef} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <div className="tw-h-full">
            <div className="tw-relative tw-flex tw-h-full tw-flex-col">
              <AgentHomeReleaseUpdate
                currentVersion={plugin.manifest.version}
                visible={isLanding && !isProjectLanding}
              />
              {!isProjectLanding && dropOverlay}
              <div
                className={
                  isLanding
                    ? "tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2"
                    : "tw-relative tw-flex tw-size-full tw-flex-col tw-overflow-hidden"
                }
                data-agent-landing={
                  isProjectLanding ? "project" : isLanding ? "global" : "conversation"
                }
              >
                <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
                <ConnectorsAttentionBanner manager={plugin.connectionManager} />
                {/* An archived chat stays open, so the chat says so and offers the way back to the lists.
                    https://github.com/Brevilabs/obsidian-copilot-private/issues/968 */}
                {!isLanding && activeChatArchived && (
                  <AgentStatusCard
                    layout="row"
                    message="This chat is archived."
                    action={{
                      label: "Unarchive",
                      onClick: () => safeAsyncHandler(handleSetActiveChatArchived)(false),
                    }}
                  />
                )}
                {isLanding ? (
                  <AgentLandingStack
                    hero={hero}
                    composer={
                      <>
                        {queuedMessagesNode}
                        {isProjectLanding ? (
                          // The project home's Files tab takes its own drops, so only the message box shows the attach
                          // overlay there. https://github.com/Brevilabs/obsidian-copilot-private/issues/461
                          <div className="tw-relative">
                            {composerNode}
                            {dropOverlay}
                          </div>
                        ) : (
                          <>
                            {composerNode}
                            {customAgentsGate === "full" && firstAgentBannerVisible && (
                              <FirstAgentBanner
                                onCreate={openCreateAgentDialog}
                                onDismiss={dismissFirstAgentBanner}
                              />
                            )}
                          </>
                        )}
                      </>
                    }
                    shelf={
                      isProjectLanding ? (
                        showProjectShelf ? (
                          <AgentHomeShelf
                            key={activeProjectId}
                            sections={projectShelfSections}
                            activeSectionId={projectShelfTab}
                            onSectionSelect={setProjectShelfTab}
                          />
                        ) : null
                      ) : (
                        <AgentHomeShelf
                          sections={landingSections}
                          activeSectionId={globalShelfTab}
                          onSectionSelect={setGlobalShelfTab}
                        />
                      )
                    }
                  />
                ) : (
                  <AgentTasksProvider tasks={tasks} openTask={handleOpenTask}>
                    {detailTask ? (
                      <TaskDetailView
                        task={detailTask}
                        status={taskDisplayStatus(detailTask, pendingToolPermissions)}
                        messages={backend.getTaskMessages(detailTask.toolCallId)}
                        app={app}
                        onBack={handleCloseTask}
                        chatAwaitsAnswer={
                          pendingToolPermissions.length > 0 || pendingAskUserQuestions.length > 0
                        }
                      />
                    ) : detailRun ? (
                      <ChatAskedAgentView
                        run={detailRun}
                        chat={activeSession}
                        hiddenChats={hiddenAgentChats}
                        messages={messages}
                        agents={chatAgents.agents}
                        app={app}
                        onBack={handleCloseTask}
                      />
                    ) : null}
                    {/* The chat stays laid out, invisible, under a task's view: hiding it with display none collapses its scroller, which then jumps to the end on Back. https://github.com/Brevilabs/obsidian-copilot-private/issues/749 */}
                    <div
                      className={cn(
                        "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col",
                        detailOpen && "tw-invisible tw-absolute tw-inset-0"
                      )}
                    >
                      <ChatAgentsContext.Provider value={chatAgents}>
                        <ChatRunsContext.Provider value={hasRun}>
                          <AgentChatMessages
                            sourcePath={activeSourcePath}
                            key={sessionId}
                            messages={messages}
                            plugin={plugin}
                            currentPlan={currentPlan}
                            pendingToolPermissions={pendingToolPermissions}
                            pendingAskUserQuestions={pendingAskUserQuestions}
                            chatBackend={backend}
                            isLoading={isLoading}
                            chatStates={chatStates}
                            onContinueFrom={handleContinueFrom}
                          />
                        </ChatRunsContext.Provider>
                      </ChatAgentsContext.Provider>
                      {queuedMessagesNode}
                      <AgentChatControls
                        onCopyChatLink={
                          activeSession?.hasUserVisibleMessages() ? handleCopyChatLink : undefined
                        }
                        getChatBookmarkState={
                          activeSession?.hasUserVisibleMessages()
                            ? getActiveChatBookmarkState
                            : undefined
                        }
                        onSetChatBookmarked={handleSetActiveChatBookmarked}
                        chatArchived={activeChatArchived}
                        onSetChatArchived={
                          activeSession?.hasUserVisibleMessages()
                            ? handleSetActiveChatArchived
                            : undefined
                        }
                        onOpenChatNote={handleOpenChatNote}
                        onReportError={handleReportError}
                        onNewChat={handleNewChat}
                        onSaveAsNote={handleSaveAsNote}
                        chatHistoryItems={chatHistoryItems}
                        onLoadHistory={handleLoadChatHistory}
                        onLoadChat={openSavedChat}
                        onUpdateChatTitle={handleUpdateChatTitle}
                        onDeleteChat={handleDeleteChat}
                        onCloseSession={handleCloseSession}
                        openChatIds={openChatIds}
                        runningChatIds={runningChatIds}
                        onOpenSourceFile={handleOpenSourceFile}
                        usageMeter={<AgentContextMeter backend={backend} />}
                        tasksIndicator={
                          <RunningTasksIndicator
                            tasks={tasks}
                            permissions={pendingToolPermissions}
                            onOpenTask={handleOpenTask}
                            onStopTask={backend.canStopTasks() ? handleStopTask : undefined}
                            container={rootEl}
                            runs={runningAgents}
                          />
                        }
                      />
                      {lockedChatAgent ? (
                        <LockedAgentChat
                          name={lockedChatAgent.name}
                          onNewChat={handleNewChat}
                          onUnlock={(ownerWindow) => unlockCustomAgents(app, ownerWindow)}
                          setup={
                            customAgentsGate !== "locked" && chatSetupProblem
                              ? {
                                  reason: agentSetupReason(lockedChatAgent.name, chatSetupProblem),
                                  onOpenProfile: () => openProfile(lockedChatAgent.slug),
                                }
                              : undefined
                          }
                        />
                      ) : (
                        composerNode
                      )}
                    </div>
                  </AgentTasksProvider>
                )}
              </div>
            </div>
          </div>
        </div>
      </AgentProfileCover>
    </div>
  );
};

export const AgentHome: React.FC<AgentHomeProps> = (props) => {
  return (
    <ChatInputProvider>
      <CustomAgentStoreContext.Provider value={props.customAgents}>
        <AgentHomeInternal {...props} />
      </CustomAgentStoreContext.Provider>
    </ChatInputProvider>
  );
};
