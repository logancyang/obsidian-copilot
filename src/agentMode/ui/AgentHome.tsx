import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AppContext } from "@/context";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useProjects } from "@/projects/state";
import { useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";

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
 * Derives a per-session view state: a session with no user-visible messages
 * shows the global landing (centered composer + read-only Projects / Recent
 * Chats); once it has messages it's the conversation. "Global" distinguishes
 * this no-project landing from the per-project landing PR2 adds. (The
 * no-session fallback is handled upstream in `AgentModeChat`.) The
 * `data-agent-landing` attribute marks the seam.
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

  const {
    messages,
    isStarting,
    hasPendingPlanPermission,
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
  } = useAgentChatRuntimeState(backend);

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

  const {
    chatHistoryItems,
    loadChatHistory: handleLoadChatHistory,
    loadChat: handleLoadChat,
    updateChatTitle: handleUpdateChatTitle,
    deleteChat: handleDeleteChat,
    openSourceFile: handleOpenSourceFile,
  } = useAgentHistoryControls(manager, plugin);

  const projects = useProjects();

  // Read-only landing in PR1: selecting a project only surfaces a coming-soon
  // notice — no project entry, no setCurrentProject, no usage touch, no session
  // or history-scope change.
  const handleProjectComingSoon = useCallback(() => {
    new Notice("Projects are coming soon.");
  }, []);

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

  // Global landing vs conversation. The runtime subscription re-renders this
  // component as the stream updates, so reading the session's display-message
  // count here re-derives in step: once the user's first message lands, the
  // surface flips from the centered landing to the conversation layout.
  const isGlobalLanding = !manager.getActiveSession()?.hasUserVisibleMessages();

  // Landing subtitle: backend display name, with the active mode when one is
  // surfaced (e.g. "Claude · Plan").
  const modeLabel = modePickerOverride?.options.find(
    (o) => o.value === modePickerOverride.value
  )?.label;
  const sessionSubtitle = modeLabel
    ? `${descriptor.displayName} · ${modeLabel}`
    : descriptor.displayName;

  // Populate the Recent Chats list whenever the landing is shown (the
  // conversation-state history popover loads on open via the same handler).
  useEffect(() => {
    if (isGlobalLanding) void handleLoadChatHistory();
  }, [isGlobalLanding, handleLoadChatHistory]);

  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <AgentTabStrip manager={manager} />
      <div className="tw-min-h-0 tw-flex-1">
        <div ref={chatContainerRef} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <div className="tw-h-full">
            <div className="tw-relative tw-flex tw-h-full tw-flex-col">
              {isDragActive && (
                <div className="tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
                  <span>Drop files here...</span>
                </div>
              )}
              {/* Composer is a position-stable node at a fixed sibling index;
                  the surrounding slots toggle so it slides from centered (global
                  landing) to bottom (conversation) without remounting and losing
                  the draft. On the landing the column scrolls as one unit and the
                  flex spacers above/below the composer keep it centered (biased
                  lower) while the section titles stay at their natural height
                  (never compressed in a narrow sidebar); in the conversation
                  state the transcript takes the flex space and the composer sits
                  at the bottom. The landing column carries one shared horizontal
                  padding (`tw-px-2`) so the composer's border and the section
                  rows share the same left/right edge — inner elements add no
                  extra horizontal padding of their own. */}
              <div
                className={
                  isGlobalLanding
                    ? "tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2"
                    : "tw-flex tw-size-full tw-flex-col tw-overflow-hidden"
                }
                data-agent-landing={isGlobalLanding ? "global" : "conversation"}
              >
                <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
                {isGlobalLanding ? (
                  <>
                    {/* Top spacer biases the composer into the lower portion of
                        the pane when there's free space (3:1 against the bottom
                        spacer). No min-height on purpose: it must collapse to 0
                        under overflow so the column packs to the top and scrolls
                        only on genuine overflow — a min-height would wedge a
                        permanent gap that coexists with a scrollbar. */}
                    <div className="tw-flex-[3]" />
                    <div className="tw-shrink-0 tw-pb-3">
                      <div className="tw-text-center tw-text-ui-larger tw-font-semibold tw-text-normal">
                        What can I help with?
                      </div>
                      <div className="tw-mt-1 tw-text-center tw-text-ui-smaller tw-text-muted">
                        {sessionSubtitle}
                      </div>
                    </div>
                  </>
                ) : (
                  <AgentChatMessages
                    messages={messages}
                    app={app}
                    currentPlan={currentPlan}
                    pendingToolPermissions={pendingToolPermissions}
                    pendingAskUserQuestions={pendingAskUserQuestions}
                    chatBackend={backend}
                    isLoading={draft.loading}
                  />
                )}
                {isGlobalLanding ? null : (
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
                )}
                <div className={isGlobalLanding ? "tw-shrink-0" : undefined}>
                  <AgentChatInput
                    backend={backend}
                    sessionId={sessionId}
                    draft={draft}
                    app={app}
                    updateUserMessageHistory={updateUserMessageHistory}
                    isStarting={isStarting}
                    hasPendingPlanPermission={hasPendingPlanPermission}
                    modelPickerOverride={modelPickerOverride ?? undefined}
                    modePickerOverride={modePickerOverride ?? undefined}
                    onCycleMode={handleCycleMode}
                  />
                </div>
                {isGlobalLanding ? (
                  <>
                    {/* Read-only landing below the composer. shrink-0 keeps the
                        section titles at full height — they're never squeezed,
                        the whole column scrolls instead. No extra horizontal
                        padding so the section edges line up with the composer's
                        border above. */}
                    <div className="tw-flex tw-shrink-0 tw-flex-col tw-gap-4 tw-pt-4">
                      <ProjectPickerList
                        projects={projects}
                        onSelect={handleProjectComingSoon}
                        onCreate={handleProjectComingSoon}
                      />
                      <GlobalRecentChatsSection
                        items={chatHistoryItems}
                        onLoadChat={handleLoadChat}
                        onUpdateTitle={handleUpdateChatTitle}
                        onDeleteChat={handleDeleteChat}
                        onOpenSourceFile={handleOpenSourceFile}
                        onLoadHistory={handleLoadChatHistory}
                      />
                    </div>
                    {/* Smaller bottom spacer balances the larger top one; also
                        collapses to 0 under overflow (no min-height). */}
                    <div className="tw-flex-1" />
                  </>
                ) : null}
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
