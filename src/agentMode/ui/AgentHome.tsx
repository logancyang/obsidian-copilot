import { useChatRelevantNotesContext } from "@/agentMode/ui/hooks/useChatRelevantNotesContext";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import AgentContextSection, { buildContextSummary } from "@/agentMode/ui/AgentContextSection";
import AgentContextStatusIcon from "@/agentMode/ui/AgentContextStatusIcon";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { CreateProjectPanel } from "@/agentMode/ui/CreateProjectPanel";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { ProjectInfoPopover } from "@/agentMode/ui/ProjectInfoPopover";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import { AgentHomeReleaseUpdate } from "@/components/release-update/AgentHomeReleaseUpdate";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import {
  getHomeShelfTab,
  setHomeShelfTab,
  HOME_SHELF_TAB_STORAGE_KEY,
} from "@/agentMode/ui/homeShelfPrefs";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { useRelevantNotesPaneOpen } from "@/agentMode/ui/useRelevantNotesPaneOpen";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { useChatInputAutoFocus } from "@/agentMode/ui/hooks/useChatInputAutoFocus";
import { useRefreshEmptyLandingOnContextSourceChange } from "@/agentMode/ui/hooks/useRefreshEmptyLandingOnContextSourceChange";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { pickRandomGreeting } from "@/agentMode/ui/landingGreetings";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { agentProjectContextLoadAtom, type ProjectConfig } from "@/aiParams";
import { makeNewProjectConfig } from "@/agentMode/ui/AgentProjectCreateForm";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { TruncatedText } from "@/components/TruncatedText";
import { AppContext } from "@/context";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectLandingCaptureSignature } from "@/projects/projectContextSignature";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import { getSettings, settingsStore, updateSetting, useSettingsValue } from "@/settings/model";
import { useAtomValue } from "jotai";
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
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;
  const settings = useSettingsValue();
  const isRelevantNotesPaneOpen = useRelevantNotesPaneOpen(app);
  const draft = useAgentInputDrafts({
    store: manager.drafts,
    chatInputId,
    defaultIncludeActiveNote: settings.autoAddActiveContentToContext === true,
  });

  useChatInputAutoFocus();

  const {
    messages,
    isStarting,
    isTurnInFlight,
    hasPendingPlanPermission,
    currentPlan,
    currentTodoList,
    pendingToolPermissions,
    pendingAskUserQuestions,
  } = useAgentChatRuntimeState(backend);
  const isLoading = draft.loading || isTurnInFlight;

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
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
      new Notice("Failed to save chat as note. Check console for details.");
    }
  }, [manager]);

  const handleNewChat = useCallback(() => {
    if (manager.getIsStarting()) return;
    const active = manager.getActiveSession();
    if (!active || !active.hasUserVisibleMessages()) return;
    const oldId = active.internalId;
    void (async () => {
      try {
        await manager.replaceSessionInPlace(oldId, active.backendId);
      } catch (e) {
        logError("[AgentMode] new chat failed", e);
        new Notice("Failed to start a new chat. Please try again.");
      }
    })();
  }, [manager]);

  const descriptor = useSessionBackendDescriptor(manager);
  const handleInstall = useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  const projects = useProjects();
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
    chatHistorySettled,
    loadChatHistory: handleLoadChatHistory,
    loadChat: handleLoadChat,
    updateChatTitle: handleUpdateChatTitle,
    deleteChat: handleDeleteChat,
    openSourceFile: handleOpenSourceFile,
  } = useAgentHistoryControls(manager, plugin, activeProjectId);

  const handleCloseSession = useCallback(
    async (id: string) => {
      try {
        await manager.closeChatSession(id);
      } catch (error) {
        logError("[AgentMode] close chat session failed", error);
        new Notice(
          `Could not close session: ${error instanceof Error ? error.message : "Try again."}`
        );
      }
    },
    [manager]
  );

  const handleLoadChatHistorySafely = safeAsyncHandler(handleLoadChatHistory);

  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const attentionChatIds = useAttentionChatIds(manager);

  const contextLoadStates = useAtomValue(agentProjectContextLoadAtom, { store: settingsStore });
  const contextLoadBlocking =
    isProjectScope && (contextLoadStates[activeProjectId]?.blocking ?? false);

  const handleExitProject = useCallback(() => {
    manager.exitProject().catch((e) => {
      logError("[AgentMode] exit project failed", e);
      new Notice("Failed to leave project. Please try again.");
    });
  }, [manager]);

  const handleProjectDeleted = useCallback(
    (deletedId: string) => {
      if (manager.getActiveProjectId() === deletedId) {
        manager.exitProject().catch((e) => {
          logError("[AgentMode] exit after delete failed", e);
        });
      }
    },
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
      const project = makeNewProjectConfig(name);
      try {
        await ProjectFileManager.getInstance(app).createProject(project);
        await manager.enterProject(project.id);
      } catch (e) {
        logError("[AgentMode] create project failed", e);
        throw e;
      }
      setCreateAnchor(null);
    },
    [app, manager]
  );

  const handleDismissWelcome = useCallback(() => {
    updateSetting("agentMode", { ...getSettings().agentMode, welcomeDismissed: true });
  }, []);

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

  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: draft.contextNotes,
    setContextNotes: draft.setContextNotes,
    selectedImages: draft.images,
    onAddImage: draft.addImages,
    containerRef: chatContainerRef,
  });

  const isLanding = !manager.getActiveSession()?.hasUserVisibleMessages();
  const isProjectLanding = isLanding && isProjectScope;

  const refreshContextForEmptyLanding = useCallback(async (): Promise<boolean> => {
    const active = manager.getActiveSession();
    if (!active || active.hasUserVisibleMessages()) return false;
    const draftEmpty =
      draft.input.trim() === "" &&
      draft.images.length === 0 &&
      draft.contextNotes.length === 0 &&
      draft.queue.length === 0;
    if (!draftEmpty) return false;
    try {
      await manager.replaceSessionInPlace(active.internalId, active.backendId, {
        preserveChatInput: true,
      });
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
    blocking: contextLoadBlocking,
    draftEmpty: draftIsEmpty,
    refresh: refreshContextForEmptyLanding,
  });

  const landingVisitKey = isProjectLanding ? `${activeProjectId}\0${sessionId}` : null;
  const placementRef = useRef<{ key: string; standalone: boolean } | null>(null);
  if (landingVisitKey === null) {
    placementRef.current = null;
  } else if (chatHistorySettled) {
    const hasChats = chatHistoryItems.length > 0;
    if (placementRef.current?.key !== landingVisitKey) {
      placementRef.current = { key: landingVisitKey, standalone: !hasChats };
    } else if (placementRef.current.standalone && hasChats) {
      placementRef.current = { key: landingVisitKey, standalone: false };
    }
  } else if (placementRef.current?.key !== landingVisitKey) {
    placementRef.current = null;
  }
  const projectPlacement = placementRef.current;

  const mainAgentId =
    manager.getActiveSession()?.backendId ?? manager.getStartingBackendId() ?? null;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId intentionally re-rolls the otherwise argument-free greeting factory
  const greeting = useMemo(() => pickRandomGreeting(), [sessionId]);

  useEffect(() => {
    if (isLanding) void handleLoadChatHistory();
  }, [isLanding, handleLoadChatHistory]);

  // global shelf unmounts whenever the user leaves the global landing — into a
  const [globalShelfTab, setGlobalShelfTabState] = useState<string | null>(() =>
    getHomeShelfTab(app, HOME_SHELF_TAB_STORAGE_KEY)
  );
  const setGlobalShelfTab = useCallback(
    (id: string) => {
      setGlobalShelfTabState(id);
      setHomeShelfTab(app, HOME_SHELF_TAB_STORAGE_KEY, id);
    },
    [app]
  );

  const landingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent Chats",
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onOpenSourceFile={handleOpenSourceFile}
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
        count: projects.length,
        renderBody: () => (
          <ProjectPickerList
            projects={projects}
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
      projects,
      projectNamesById,
      chatHistoryItems,
      app,
      projectUsageManager,
      handleSelectProject,
      handleCreateProject,
      handleProjectDeleted,
      handleLoadChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleOpenSourceFile,
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

  const contextSummary = useMemo(() => buildContextSummary(activeProject), [activeProject]);

  const projectLandingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "project-chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent Chats",
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            variant="project"
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onOpenSourceFile={handleOpenSourceFile}
            onLoadHistory={handleLoadChatHistorySafely}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
            sortStrategy={settings.chatHistorySortStrategy}
          />
        ),
      },
      {
        id: "project-context",
        icon: <Files className="tw-size-4" />,
        title: "Context",
        count: contextSummary.totalItems,
        renderBody: () => (
          <AgentContextSection app={app} projectId={activeProjectId} popoverContainer={rootEl} />
        ),
      },
    ],
    [
      chatHistoryItems,
      contextSummary.totalItems,
      app,
      activeProjectId,
      rootEl,
      handleLoadChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleOpenSourceFile,
      handleLoadChatHistorySafely,
      openChatIds,
      handleCloseSession,
      runningChatIds,
      attentionChatIds,
      settings.chatHistorySortStrategy,
    ]
  );

  const openProjectManageModal = () => {
    if (!activeProject) return;
    new ContextManageModal(
      app,
      (updated) => {
        void ProjectFileManager.getInstance(app)
          .updateProject(activeProjectId, updated)
          .catch((err) => logError("[AgentMode] save context changes failed", err));
      },
      activeProject
    ).open();
  };

  const contextStatusIndicator =
    isProjectScope && !isOrphanedProject && activeProject ? (
      <AgentContextStatusIcon
        app={app}
        activeProjectId={activeProjectId}
        project={activeProject}
        hasConfiguredContextSource={!contextSummary.isEmpty}
        landing={isLanding}
        onReindex={() => manager.rematerializeContext(activeProjectId)}
        onRetryItem={(item) =>
          manager
            .rematerializeSource(activeProjectId, {
              kind: item.cacheKind,
              source: item.id,
            })
            .catch((e) => {
              logError("[AgentMode] retry source failed", e);
              return false;
            })
        }
        onRefreshLanding={refreshContextForEmptyLanding}
        onEditContext={openProjectManageModal}
      />
    ) : undefined;

  const composerNode = (
    <AgentChatInput
      backend={backend}
      plugin={plugin}
      chatInputId={chatInputId}
      draft={draft}
      app={app}
      mainAgentId={mainAgentId}
      updateUserMessageHistory={updateUserMessageHistory}
      isStarting={isStarting}
      isLoading={isLoading}
      hasPendingPlanPermission={hasPendingPlanPermission}
      modelPickerOverride={modelPickerOverride ?? undefined}
      modePickerOverride={modePickerOverride ?? undefined}
      onCycleMode={handleCycleMode}
      activeProjectId={activeProjectId}
      contextLoadBlocking={contextLoadBlocking}
      disabled={isOrphanedProject}
      contextStatusIndicator={contextStatusIndicator}
    />
  );

  const showProjectHero = isProjectLanding && !isOrphanedProject;
  const heroText = showProjectHero ? `Chat in ${projectName}` : greeting;
  const hero = (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-center tw-gap-3">
      <CopilotBrandIcon className="tw-size-6 tw-shrink-0 tw-text-normal" />
      <TruncatedText
        className="tw-min-w-0 tw-text-3xl tw-font-[330] tw-text-normal"
        tooltipContent={heroText}
      >
        {heroText}
      </TruncatedText>
    </div>
  );

  const activeSession = manager.getSession(sessionId);
  const nativeSessionId = activeSession?.getBackendSessionId();
  const chatLinkId =
    manager.getSessionSourcePath(sessionId) ||
    (activeSession && nativeSessionId
      ? buildNativeChatId(activeSession.backendId, nativeSessionId)
      : undefined);

  return (
    <div ref={setRootEl} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div
        className={cn(
          "tw-grid tw-shrink-0 tw-transition-[grid-template-rows,opacity] tw-duration-200 tw-ease-out motion-reduce:tw-transition-none",
          isProjectScope
            ? "tw-grid-rows-[1fr] tw-opacity-100"
            : "tw-pointer-events-none tw-grid-rows-[0fr] tw-opacity-0"
        )}
        aria-hidden={!isProjectScope}
      >
        <div className="tw-min-h-0 tw-overflow-hidden">
          <AgentProjectHeader
            projectName={headerName}
            onExit={handleExitProject}
            orphaned={headerOrphaned}
            menu={
              activeProject ? (
                <ProjectInfoPopover
                  app={app}
                  project={activeProject}
                  todoList={currentTodoList}
                  container={rootEl}
                />
              ) : undefined
            }
          />
        </div>
      </div>
      <AgentTabStrip manager={manager} />
      {createAnchor && (
        <CreateProjectPanel
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onSave={persistCreateProject}
        />
      )}
      <div className="tw-min-h-0 tw-flex-1">
        <div ref={chatContainerRef} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <div className="tw-h-full">
            <div className="tw-relative tw-flex tw-h-full tw-flex-col">
              <AgentHomeReleaseUpdate
                currentVersion={plugin.manifest.version}
                visible={isLanding && !isProjectLanding}
              />
              {isDragActive && (
                <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
                  <span>Drop files here...</span>
                </div>
              )}
              <div
                className={
                  isLanding
                    ? "tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2"
                    : "tw-flex tw-size-full tw-flex-col tw-overflow-hidden"
                }
                data-agent-landing={
                  isProjectLanding ? "project" : isLanding ? "global" : "conversation"
                }
              >
                <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
                {isLanding ? (
                  <AgentLandingStack
                    hero={hero}
                    composer={composerNode}
                    floating={
                      !isProjectLanding &&
                      projects.length === 0 &&
                      !settings.agentMode.welcomeDismissed ? (
                        <AgentWelcomeCard
                          onCreate={handleCreateProject}
                          onDismiss={handleDismissWelcome}
                        />
                      ) : undefined
                    }
                    context={
                      isProjectLanding && !isOrphanedProject && projectPlacement?.standalone ? (
                        <div className="tw-px-2 tw-pb-1 tw-pt-3">
                          <AgentContextSection
                            app={app}
                            projectId={activeProjectId}
                            popoverContainer={rootEl}
                          />
                        </div>
                      ) : undefined
                    }
                    shelf={
                      isProjectLanding ? (
                        projectPlacement && !projectPlacement.standalone ? (
                          <AgentHomeShelf key={activeProjectId} sections={projectLandingSections} />
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
                  <>
                    <AgentChatMessages
                      sourcePath={manager.getSessionSourcePath(sessionId)}
                      key={sessionId}
                      messages={messages}
                      app={app}
                      currentPlan={currentPlan}
                      pendingToolPermissions={pendingToolPermissions}
                      pendingAskUserQuestions={pendingAskUserQuestions}
                      chatBackend={backend}
                      isLoading={isLoading}
                    />
                    <AgentChatControls
                      chatLinkId={chatLinkId}
                      onCopyChatLink={(id) => plugin.copyChatLink(id)}
                      onNewChat={handleNewChat}
                      onSaveAsNote={handleSaveAsNote}
                      chatHistoryItems={chatHistoryItems}
                      onLoadHistory={handleLoadChatHistory}
                      onLoadChat={handleLoadChat}
                      onUpdateChatTitle={handleUpdateChatTitle}
                      onDeleteChat={handleDeleteChat}
                      onCloseSession={handleCloseSession}
                      openChatIds={openChatIds}
                      runningChatIds={runningChatIds}
                      onOpenSourceFile={handleOpenSourceFile}
                      usageMeter={<AgentContextMeter backend={backend} />}
                      showMultiAgentUpsell
                    />
                    {composerNode}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AgentHome: React.FC<AgentHomeProps> = (props) => {
  return (
    <ChatInputProvider>
      <AgentHomeInternal {...props} />
    </ChatInputProvider>
  );
};

export default AgentHome;
