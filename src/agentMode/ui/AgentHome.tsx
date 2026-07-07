import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import AgentContextSection, { buildContextSummary } from "@/agentMode/ui/AgentContextSection";
import AgentContextStatusIcon from "@/agentMode/ui/AgentContextStatusIcon";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { CreateProjectPanel } from "@/agentMode/ui/CreateProjectPanel";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { ProjectInfoPopover } from "@/agentMode/ui/ProjectInfoPopover";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import { CopilotBrandIcon } from "@/agentMode/ui/CopilotBrandIcon";
import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
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
import { EVENT_NAMES } from "@/constants";
import { AppContext, ChatViewEventTarget, EventTargetContext } from "@/context";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectLandingCaptureSignature } from "@/projects/projectContextSignature";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import { getSettings, settingsStore, updateSetting, useSettingsValue } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Files, Folder, MessageSquare } from "lucide-react";
import { Notice } from "obsidian";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface AgentHomeProps {
  backend: AgentChatBackend;
  /** Active session's internal id — drives per-session draft selection. */
  sessionId: string;
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

/**
 * Agent Mode home surface for an active session. Persistent across tab switches
 * (the tab strip swaps `sessionId`/`backend` props), so input drafts live in
 * `AgentChatInput` keyed by session rather than being reset by a `key` remount.
 *
 * Derives a per-session view state across three surfaces: a session with no
 * user-visible messages is a landing — global (no project scope: top-anchored
 * composer over Recent Chats / Projects) or per-project (the project's hero +
 * scoped Recent Chats); once it has messages it's the conversation. The global
 * and project landings share `AgentLandingStack`. The project header mounts over
 * both the project landing and the in-project conversation. (The no-session
 * fallback is handled upstream in `AgentModeChat`.) The `data-agent-landing`
 * attribute ("global" | "project" | "conversation") marks the seam.
 */
const AgentHomeInternal: React.FC<AgentHomeProps> = ({
  backend,
  sessionId,
  manager,
  plugin,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;
  const settings = useSettingsValue();
  const eventTarget = useContext(EventTargetContext);
  const chatInput = useChatInput();

  // Place the caret in the composer when the agent view opens so the user can
  // type immediately. AgentHome only mounts once preload settles and a session
  // exists, so this fires when the input actually appears (and again on
  // close/reopen, which remounts this tree).
  useChatInputAutoFocus();

  // Insert text routed from outside the chat (e.g. the Relevant Notes pane's
  // "Add to Chat") into the active session's composer. The bus latches text
  // queued before this listener attaches, so a freshly-opened view still
  // receives it on mount.
  useEffect(() => {
    const bus = eventTarget instanceof ChatViewEventTarget ? eventTarget : null;
    const handleInsertText = (e: Event) => {
      bus?.consumePendingInsertText();
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text === "string") chatInput.insertTextWithPills(text, true);
    };
    eventTarget?.addEventListener(EVENT_NAMES.INSERT_TEXT_TO_CHAT, handleInsertText);
    const pending = bus?.consumePendingInsertText();
    if (typeof pending === "string") chatInput.insertTextWithPills(pending, true);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.INSERT_TEXT_TO_CHAT, handleInsertText);
    };
  }, [eventTarget, chatInput]);

  const {
    messages,
    isStarting,
    hasPendingPlanPermission,
    currentPlan,
    currentTodoList,
    pendingToolPermissions,
    pendingAskUserQuestions,
  } = useAgentChatRuntimeState(backend);

  // Whole-surface root — the portal container for header-anchored overlays
  // (the project-info popover), which live OUTSIDE chatContainerRef. Held in
  // state (not a plain ref) so the popover re-renders once the node mounts and
  // actually receives the container instead of the first-render `null`.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // External callers (CopilotPlugin.autosaveCurrentChat → CopilotAgentView.saveChat)
  // already gate on `settings.autosaveChat`, so this handler is the autosave-on
  // path — silent on success. The manual Save button uses `handleSaveAsNote`
  // below, which surfaces a Notice on completion.
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
    // Already on a fresh session — no-op so the user doesn't churn ACP
    // sessions just by clicking the button repeatedly.
    if (!active || !active.hasUserVisibleMessages()) return;
    const oldId = active.internalId;
    void (async () => {
      try {
        // Replace the current tab in place: same backend, same tab-strip
        // position. createSession + closeSession would append the new
        // session at the end and shift focus away from the user's slot.
        await manager.replaceSessionInPlace(oldId, active.backendId);
      } catch (e) {
        logError("[AgentMode] new chat failed", e);
        new Notice("Failed to start a new chat. Please try again.");
      }
    })();
    // replaceSessionInPlace mints a new internal id, so the input resets via
    // that session's fresh draft and AgentChatInput clears the global selected
    // text on the session switch — no explicit reset needed here.
  }, [manager]);

  const descriptor = useSessionBackendDescriptor(manager);
  const handleInstall = useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  const projects = useProjects();

  // Shared in-memory usage manager — the SAME instance `enterProject` touches. The
  // picker blends it so entering a project reorders the landing list immediately,
  // before the throttled disk persist catches up.
  const projectUsageManager = useMemo(
    () => ProjectFileManager.getInstance(app).getProjectUsageTimestampsManager(),
    [app]
  );

  // Active scope drives the third (per-project) landing state and scopes the
  // history list. `GLOBAL_SCOPE` is the implicit global workspace. Read fresh
  // each render: the manager re-renders this tree on scope switch, and
  // `useProjects()` re-renders it on project create/rename/delete — so the
  // derived name and orphan flag stay live.
  const activeProjectId = manager.getActiveProjectId();
  const isProjectScope = activeProjectId !== GLOBAL_SCOPE;
  const activeProject = isProjectScope ? projects.find((p) => p.id === activeProjectId) : undefined;
  // The scope still points at a project whose record is gone (folder/`project.md`
  // deleted while the user was inside it). Degrade rather than crash: the header
  // keeps only the `‹` escape hatch, the composer hard-disables, and a one-time Notice fires.
  const isOrphanedProject = isProjectScope && !activeProject;
  const projectName = activeProject?.name ?? "";
  // Latch the in-project header content so its exit collapse animates with the
  // project it's leaving: `projectName`/`isOrphanedProject` flip to their global
  // values the instant the scope changes, before the header's collapse finishes,
  // which would otherwise flash an empty name mid-animation. The id rides along
  // so the identity tile's color doesn't flash either. Writing the ref during
  // render is the same derive-from-props pattern the context-load card uses.
  // The global-scope initial id only ever lives in a collapsed, aria-hidden
  // header; the first project entry latches a real project id.
  const lastProjectHeaderRef = useRef({
    id: activeProjectId,
    name: projectName,
    orphaned: isOrphanedProject,
  });
  if (isProjectScope) {
    lastProjectHeaderRef.current = {
      id: activeProjectId,
      name: projectName,
      orphaned: isOrphanedProject,
    };
  }
  const headerProjectId = isProjectScope ? activeProjectId : lastProjectHeaderRef.current.id;
  const headerName = isProjectScope ? projectName : lastProjectHeaderRef.current.name;
  const headerOrphaned = isProjectScope ? isOrphanedProject : lastProjectHeaderRef.current.orphaned;

  // Scope the history list to the active project (project id) or the flat
  // all-chats view (`GLOBAL_SCOPE`). One wiring fixes both the landing's
  // project Recent Chats shelf and the conversation-state History popover, which share
  // this hook.
  const {
    chatHistoryItems,
    chatHistorySettled,
    loadChatHistory: handleLoadChatHistory,
    loadChat: handleLoadChat,
    updateChatTitle: handleUpdateChatTitle,
    deleteChat: handleDeleteChat,
    openSourceFile: handleOpenSourceFile,
  } = useAgentHistoryControls(manager, plugin, activeProjectId);

  // Recent-list rows show a spinner for any chat whose backend turn is still
  // running in the background (the session keeps streaming when its tab is
  // parked), and a live done-dot the moment that turn finishes. Shared by both
  // the global and per-project landing shelves.
  const runningChatIds = useRunningChatIds(manager);
  const attentionChatIds = useAttentionChatIds(manager);

  // Blocking signal for the composer's send-gate: true while the active
  // project's context is still materializing. Read-only here — the materializer
  // owns writes to this atom.
  const contextLoadStates = useAtomValue(agentProjectContextLoadAtom, { store: settingsStore });
  const contextLoadBlocking =
    isProjectScope && (contextLoadStates[activeProjectId]?.blocking ?? false);

  // Leave the project scope, returning to the global workspace.
  const handleExitProject = useCallback(() => {
    manager.exitProject().catch((e) => {
      logError("[AgentMode] exit project failed", e);
      new Notice("Failed to leave project. Please try again.");
    });
  }, [manager]);

  // A project was deleted via its `⋯` menu. If it was the active scope (deleted
  // from the project header), drop back to the global workspace so we don't sit
  // on a now-orphaned scope.
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

  // Enter a project from the global shelf's Projects tab (P0 entry point).
  const handleSelectProject = useCallback(
    (project: ProjectConfig) => {
      manager.enterProject(project.id).catch((e) => {
        logError("[AgentMode] enter project failed", e);
        new Notice("Failed to open project. Please try again.");
      });
    },
    [manager]
  );

  // Name-only create: the modal assembles a full ProjectConfig; we persist it
  // and drop straight into its landing. Rethrow on failure so the modal stays
  // open instead of closing on a write that didn't land.
  // Open the anchored name-only create panel next to whichever trigger was
  // clicked (the "+ New project" row or the Welcome card button), so it appears
  // beside the trigger instead of dead-center like the full edit modal.
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
  const handleCreateProject = useCallback((anchorEl: HTMLElement) => {
    setCreateAnchor(anchorEl);
  }, []);

  // Persist a name-only project then enter it. A reject (e.g. a duplicate name)
  // bubbles to the panel's form, which shows a Notice and keeps the panel open.
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

  // Persist the global-landing Welcome card's dismissal. `updateSetting` replaces
  // the whole `agentMode` object, so spread the freshest copy first.
  const handleDismissWelcome = useCallback(() => {
    updateSetting("agentMode", { ...getSettings().agentMode, welcomeDismissed: true });
  }, []);

  // Surface the orphaned-scope condition once when it appears (project deleted
  // out from under the active session). The header + disabled composer let the
  // user back out via the `‹` escape hatch.
  useEffect(() => {
    if (isOrphanedProject) new Notice("This project no longer exists.");
  }, [isOrphanedProject]);

  const modelPickerOverride = useAgentModelPicker(manager);
  const modePickerOverride = useAgentModePicker(manager);

  const handleCycleMode = useCallback(() => {
    if (!modePickerOverride || modePickerOverride.disabled) return;
    const { options, value, onChange } = modePickerOverride;
    if (options.length === 0) return;
    const currentIdx = options.findIndex((o) => o.value === value);
    const next = options[(currentIdx + 1) % options.length];
    if (next.value !== value) onChange(next.value);
  }, [modePickerOverride]);

  // Stable list of live session ids so the draft store's pruning and memo
  // don't churn on every manager notify (getSessions() returns a fresh array).
  // The "\0" delimiter (matching useAgentInputDrafts' own signature key) can't
  // appear in a session id, so distinct id sets always produce distinct keys.
  const sessions = manager.getSessions();
  const liveKey = sessions.map((s) => s.internalId).join("\0");
  const liveSessionIds = useMemo(() => sessions.map((s) => s.internalId), [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-session compose drafts live in the shell (the common owner) so the
  // active turn's `loading` (transcript spinner) and the drop overlay's drag
  // state can be read directly here, instead of being mirrored up from the
  // composer via effect callbacks. The hook returns a referentially stable
  // controls object, so passing it down to the memoized AgentChatInput doesn't
  // re-render the composer on per-token stream updates.
  const draft = useAgentInputDrafts({
    activeSessionId: sessionId,
    liveSessionIds,
    defaultIncludeActiveNote: settings.autoAddActiveContentToContext === true,
  });

  // Whole chat area is the drop zone (bound to chatContainerRef), so files
  // dropped anywhere — not just on the composer — attach to the active draft.
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: draft.contextNotes,
    setContextNotes: draft.setContextNotes,
    selectedImages: draft.images,
    onAddImage: draft.addImages,
    containerRef: chatContainerRef,
  });

  // Three surfaces, derived per render (the runtime subscription re-renders as
  // the stream updates, so the message-count read re-derives in step): a session
  // with no user-visible messages is a landing — global (no project scope) or
  // per-project — and once its first message lands it becomes the conversation.
  const isLanding = !manager.getActiveSession()?.hasUserVisibleMessages();
  const isProjectLanding = isLanding && isProjectScope;

  // A session captures its `<project_context>` block + searchable roots once, at
  // start (AgentSession.initialize awaiting `contextReady`). So after a Retry /
  // Edit re-materializes, a still-empty landing session would otherwise keep the
  // STALE inline block until a new chat. Replace it in place (the handleNewChat
  // pattern) so its fresh `initialize()` re-captures the new context — createSession
  // joins the just-started materialization (single-flight by project) on Retry, or
  // re-materializes the updated config on Edit. Guarded on an EMPTY draft so a
  // refresh never interrupts a draft already in progress. The replace mints a new
  // session id and prunes the old draft, so to honor "never discard text the user
  // has started typing" we also migrate any draft typed during the async startup
  // window onto the new id (the pre-await check can't see those late keystrokes).
  // Returns whether a swap actually happened (false = guarded no-op), so the
  // context-source observer advances its baseline only on a real capture.
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
      const replacement = await manager.replaceSessionInPlace(active.internalId, active.backendId);
      draft.migrateDraft(active.internalId, replacement.internalId);
      return true;
    } catch (e) {
      logError("[AgentMode] refresh landing context failed", e);
      return false;
    }
  }, [manager, draft]);

  // Reactively refresh the empty landing when the active project's context
  // sources change underneath it (drag-drop / inline edit / +URL / chip removal
  // / Manage modal all funnel through the project store, which re-renders here).
  // The status icon's Retry keeps its own direct refresh — it re-captures from
  // the cache WITHOUT a project-store write, so this observer never sees it.
  const draftIsEmpty =
    draft.input.trim() === "" &&
    draft.images.length === 0 &&
    draft.contextNotes.length === 0 &&
    draft.queue.length === 0;
  // Fingerprint of what an empty landing session captures at creation: the
  // materialization signature PLUS the project instructions. Deliberately
  // broader than the session manager's materialization dirty-tracking signature,
  // because a landing also bakes in AGENTS.md / Claude's instruction append — so
  // a System-Prompt-only edit must refresh it. Read from the live record;
  // `projects` is a deliberate re-derive trigger — not read inside the factory,
  // but a `useProjects()` change means the cached record may have changed.
  const activeProjectLandingCaptureSignature = useMemo(() => {
    if (!isProjectScope) return null;
    const record = getCachedProjectRecordById(activeProjectId);
    return record ? getProjectLandingCaptureSignature(record) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectScope, activeProjectId, projects]);
  useRefreshEmptyLandingOnContextSourceChange({
    activeProjectId,
    signature: activeProjectLandingCaptureSignature,
    isLanding,
    blocking: contextLoadBlocking,
    draftEmpty: draftIsEmpty,
    refresh: refreshContextForEmptyLanding,
  });

  // Project landing lower-area placement: zero chats → the Context body renders
  // standalone below the composer (no shelf); any chats → the tabbed shelf
  // (Recent Chats / Context). Decided per landing VISIT (project + session) and
  // latched, so in-visit churn can't swap the layout under the user:
  //
  // - Undecided until the scoped history load settles — rendering neither beats
  //   flashing the wrong branch (e.g. mistaking "not loaded yet" for "no chats").
  // - One-way upgrade standalone→shelf: the settle can be a stale list from the
  //   previous visit (e.g. "New chat" right after a project's first
  //   conversation), so a refresh that finds chats corrects the layout — that
  //   flip lands within the visit's first moments, while the reverse
  //   (shelf→standalone, e.g. deleting the last chat from the View-all popover
  //   mid-visit) would yank the card out from under an open popover. The shelf
  //   just shows the project empty copy until the next visit re-decides.
  //
  // Written during render — the same derive-from-props pattern as the header
  // latch above.
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

  // The session's main agent — the summarizer and the dedup anchor for
  // `@`-mentions. The composer belongs to the ACTIVE session, so anchor to its
  // backend whenever one exists; fall back to the starting backend only for the
  // initial no-session startup. (Preferring the starting backend would mis-anchor
  // mentions to a backend cold-starting in another tab — e.g. `@opencode` from a
  // visible Claude chat would collapse to the degenerate single-agent path.)
  const mainAgentId =
    manager.getActiveSession()?.backendId ?? manager.getStartingBackendId() ?? null;

  // Rotating landing greeting: re-rolled per session id (so each fresh chat /
  // landing open gets a new line) but stable across the stream re-renders within
  // a session, so it doesn't flicker as tokens arrive. sessionId is the
  // intentional re-roll trigger — not read inside the factory, so exhaustive-deps
  // flags it; the dep is deliberate (same as the liveSessionIds memo above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const greeting = useMemo(() => pickRandomGreeting(), [sessionId]);

  // Populate the chats list whenever a landing (global or per-project) is shown
  // (the conversation-state history popover loads on open via the same handler).
  // `handleLoadChatHistory` changes identity when the scope changes, so entering
  // a project re-fetches its scoped chats here.
  useEffect(() => {
    if (isLanding) void handleLoadChatHistory();
  }, [isLanding, handleLoadChatHistory]);

  // Global shelf tab lives HERE (not in the shelf's own state) because the
  // global shelf unmounts whenever the user leaves the global landing — into a
  // project, or into a conversation and back via New Chat. This is deliberate
  // instance-level UI memory: wherever the user left the global shelf, they
  // return to it (entering a project from the Projects tab and backing out
  // lands on Projects again instead of snapping to Recent Chats). AgentHome
  // stays mounted across those switches, so the state survives. null = nothing
  // picked yet → the shelf resolves to its first selectable tab.
  const [globalShelfTab, setGlobalShelfTab] = useState<string | null>(null);

  // Chip-shelf sections for the landing. Each body renders lazily (only the open
  // section is mounted), so these render closures are cheap to recreate.
  const landingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent Chats",
        count: chatHistoryItems.length,
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onOpenSourceFile={handleOpenSourceFile}
            onLoadHistory={handleLoadChatHistory}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
          />
        ),
      },
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
      handleLoadChatHistory,
      runningChatIds,
      attentionChatIds,
    ]
  );

  // Context tab count, computed here because the tab chip must show it while
  // the tab body is unmounted (the shelf mounts only the active tab). Pure
  // derivation from the cached record, so edits/drops keep it live.
  const contextSummary = useMemo(() => buildContextSummary(activeProject), [activeProject]);

  // Per-project landing shelf: the same tabbed card as the global landing, with
  // scoped sections — Recent Chats first (default tab, identical to the global
  // tab of the same name, just scoped; chat creation belongs to the tab strip's "+"
  // on both landings), then the project Context body. Only rendered once the
  // project has chats; a zero-chat project gets the standalone Context body
  // instead (see projectPlacement above).
  const projectLandingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "project-chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: "Recent Chats",
        count: chatHistoryItems.length,
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            variant="project"
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onOpenSourceFile={handleOpenSourceFile}
            onLoadHistory={handleLoadChatHistory}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
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
      handleLoadChatHistory,
      runningChatIds,
      attentionChatIds,
    ]
  );

  // One composer element, shared by all three surfaces. The project-scope props
  // drive the send-gate: `activeProjectId` + `contextLoadBlocking` make a send
  // queue-and-hold while context materializes; `disabled` hard-stops sends when
  // the active project is orphaned.
  // Project-context status icon for the composer's badge row. Only a real
  // (non-orphaned) project scope has context to report; global + orphaned omit it.
  // `onEditContext` opens the Manage Context modal (the same link/file/tag
  // manager as the Context tab's Manage button), so the status popover edits
  // context sources directly rather than detouring through the full Edit Project
  // form. `onReindex` forces a re-materialization past the failure cache and
  // calls `refreshContextForEmptyLanding` directly (it re-captures from the
  // cache without a project-store write, so the source observer never sees it).
  // `onEditContext`'s save, by contrast, writes the project store and lets the
  // observer refresh the landing — so it must NOT also refresh directly.
  const openProjectManageModal = () => {
    if (!activeProject) return;
    new ContextManageModal(
      app,
      (updated) => {
        // The save writes through the project store, which the landing's
        // context-source observer ({@link useRefreshEmptyLandingOnContextSourceChange})
        // watches — so it refreshes the empty landing on its own. No direct
        // refresh here, or the store update and this call would each fire a
        // replaceSessionInPlace (double refresh).
        void ProjectFileManager.getInstance(app)
          .updateProject(activeProjectId, updated)
          .catch((err) => logError("[AgentMode] save context changes failed", err));
      },
      activeProject,
      { enableLinks: true }
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
        // The status icon defers this to popover-close so a retry's completion
        // can't swap the session and yank the popover shut mid-inspection.
        onRefreshLanding={refreshContextForEmptyLanding}
        onEditContext={openProjectManageModal}
      />
    ) : undefined;

  const composerNode = (
    <AgentChatInput
      backend={backend}
      sessionId={sessionId}
      draft={draft}
      app={app}
      mainAgentId={mainAgentId}
      updateUserMessageHistory={updateUserMessageHistory}
      isStarting={isStarting}
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

  // Hero: a single title line above the composer — the rotating greeting
  // (global) or "Chat in <project>" (project landing). An orphaned scope falls
  // back to the neutral greeting so no "Chat in" line renders against a blank
  // name. The project landing carries no subtitle: just the title.
  const showProjectHero = isProjectLanding && !isOrphanedProject;
  const heroText = showProjectHero ? `Chat in ${projectName}` : greeting;
  const hero = (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-center tw-gap-3">
      <CopilotBrandIcon className="tw-size-4 tw-shrink-0 tw-text-normal" />
      {/* font-[330]: deliberate hero weight, a hair lighter than `font-normal`
          (400) for the airy greeting. The project's named weight tokens have no
          slot between light and normal, so this is an intentional one-off. (The
          "no arbitrary values" rule targets font sizes, not weights.) Promote to
          a named token if another weight like this appears.

          TruncatedText (not flex-1) so a long project name ellipsizes with a
          full-text tooltip while a short title keeps the icon+text pair
          centered — flex-1 would stretch the text box and break the centering. */}
      <TruncatedText
        className="tw-min-w-0 tw-text-ui-title tw-font-[330] tw-text-normal"
        tooltipContent={heroText}
      >
        {heroText}
      </TruncatedText>
    </div>
  );

  return (
    <div ref={setRootEl} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      {/* Project header sits ABOVE the tab strip: a project scope is just the
          global layout (tab strip → landing/conversation) with the project
          header prepended on top. It spans BOTH the project landing and the
          in-project conversation so sending the first message never drops the
          project scope from view.

          It animates open/closed on scope change instead of popping: the grid
          row transitions 1fr↔0fr over an overflow-hidden child, so the header's
          auto height collapses smoothly and the tab strip + content below slide
          with it. Kept mounted (not conditionally rendered) so BOTH enter and
          exit animate; collapsed it's a 0-height, hidden, non-interactive row —
          visually identical to absent, so the global layout is unchanged. */}
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
            projectId={headerProjectId}
            projectName={headerName}
            onExit={handleExitProject}
            orphaned={headerOrphaned}
            menu={
              activeProject ? (
                <ProjectInfoPopover
                  app={app}
                  project={activeProject}
                  todoList={currentTodoList}
                  // The header sits OUTSIDE chatContainerRef, so the popover
                  // portals into the AgentHome root for popout correctness.
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
              {isDragActive && (
                // pointer-events-none: this is visual feedback only — if the
                // overlay caught events, every dragover after the first would
                // target it and inner drop zones (the project context section)
                // would become unreachable.
                <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
                  <span>Drop files here...</span>
                </div>
              )}
              {/* Two surfaces share this padded, scrollable column: a landing
                  (global or per-project, laid out by AgentLandingStack —
                  top-anchored composer over a tabbed shelf) and the conversation
                  (transcript + controls + bottom composer). The shared `tw-px-2`
                  keeps the composer border and shelf rows on one left/right edge,
                  so inner elements add no horizontal padding of their own.

                  The composer (`composerNode`) is the same element in both
                  branches but sits at different tree positions, so it remounts on
                  the landing→conversation flip. That flip only fires right after
                  a send (which already reset the draft) or on a chat load (which
                  changes `sessionId` and remounts anyway); the per-session draft
                  lives in AgentHome and survives. CAUTION: the flip happens
                  DURING the first turn, so the unmounting composer instance still
                  has an in-flight `runSend` — anything that turn must do on
                  completion (clearing `draft.loading`) MUST NOT be gated on the
                  composer still being mounted (see runSend's finally). */}
              <div
                className={
                  // Landing: overflow-y-auto, not hidden — the h-1/4 spacer +
                  // flex-1 shelf fill the column exactly when there's room, and on
                  // a pane too short to fit the stack the column scrolls instead of
                  // clipping it out of reach. Conversation: the transcript owns its
                  // own scroll, so this stays hidden.
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
                      // Global landing with no projects yet → the dismissible
                      // Welcome card. (Project context status now lives on the
                      // composer's status icon, not a floating load card.)
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
                      // Zero-chat project landing: the Context body standalone
                      // below the composer (mutually exclusive with the shelf;
                      // see projectPlacement). Skipped for an orphaned id — the
                      // body renders null for an unknown project and the
                      // wrapper would leave a stray padded gap.
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
                        // Tabbed Recent Chats / Context card, only once the
                        // project has chats. Keyed by project so the selected
                        // tab resets instead of leaking across scope switches
                        // (the global and project shelves share this slot).
                        // null while the placement is undecided (history not
                        // settled) or standalone — the stack drops the shelf
                        // wrapper entirely so no empty gap remains.
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
                      messages={messages}
                      app={app}
                      currentPlan={currentPlan}
                      pendingToolPermissions={pendingToolPermissions}
                      pendingAskUserQuestions={pendingAskUserQuestions}
                      chatBackend={backend}
                      isLoading={draft.loading}
                    />
                    <AgentChatControls
                      onNewChat={handleNewChat}
                      onSaveAsNote={handleSaveAsNote}
                      chatHistoryItems={chatHistoryItems}
                      onLoadHistory={handleLoadChatHistory}
                      onLoadChat={handleLoadChat}
                      onUpdateChatTitle={handleUpdateChatTitle}
                      onDeleteChat={handleDeleteChat}
                      onOpenSourceFile={handleOpenSourceFile}
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
