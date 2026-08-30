import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentSelectPanel } from "@/agentMode/ui/AgentSelectPanel";
import { AgentSelectPane } from "@/agentMode/ui/AgentSelectPane";
import {
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { t } from "@/i18n";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

/**
 * Keeps the dedicated Agent Mode pane synchronized with the active scope and backend throughout session startup.
 * @param plugin - The plugin instance that owns Agent Mode runtime services.
 * @param onSaveChat - The callback that exposes the current conversation's save action.
 * @param updateUserMessageHistory - The callback that records submitted messages for input history.
 */
export const AgentModeChat: React.FC<Props> = ({
  plugin,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const manager = plugin.agentSessionManager;
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  // Manager fires `notify()` on preload settle, which bumps `tick` above and
  // re-renders this component — so we can read the flag directly each render.
  // Gate only on the backend being started or shown so a slow unrelated
  // backend never holds the chat hostage; the picker shows per-backend
  // loading rows for the others.
  const preloadReady = manager?.isPreloadReady(descriptor.id) ?? true;

  // Auto-spawn the first session on mount. The manager de-dupes concurrent
  // creators via creatingSession, so this is safe to fire whenever the
  // dependencies change. Skip if the backend isn't installed (the install
  // pill takes over), there's a prior boot error (Retry handles it), or
  // the active backend's preload hasn't settled (its catalog isn't in
  // cache yet — kicking off `newSession` would trigger a redundant
  // on-demand probe).
  React.useEffect(() => {
    if (!manager) return;
    if (!preloadReady) return;
    // Gate on the *current scope's* sessions, not the whole pool: closing the
    // last session in a scope (project or global) nulls the active session but
    // keeps `activeProjectId` put, so we must re-spawn that scope's landing even
    // when another scope still holds sessions. A whole-pool guard would leave the
    // pane on the no-session fallback instead of the scope's landing.
    // `getOrCreateActiveSession` is scope-aware and the manager de-dupes per
    // scope, so this can't double-spawn.
    if (manager.getSessionsForScope(manager.getActiveProjectId()).length > 0) return;
    if (manager.getIsStarting()) return;
    if (manager.getLastError()) return;
    if (installState.kind !== "ready") return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
    // tick forces re-evaluation when the manager's pool changes.
  }, [manager, installState.kind, preloadReady, tick]);

  const handleInstall = React.useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  if (!manager) return null;

  // Render a loading placeholder until plugin-load preload settles. This
  // guarantees the picker (and effort dropdown) read from a populated
  // cache on first paint instead of flashing an empty list.
  if (!preloadReady) {
    return (
      <div className="tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted">
        {t("agentChat.status.loadingModels")}
      </div>
    );
  }

  const activeSession = manager.getActiveSession();
  const backend = manager.getActiveChatUIState();
  if (activeSession && backend) {
    // AgentHome owns the tab strip + chat surface and persists across tab
    // switches: it keys input drafts by session id internally, so switching
    // tabs swaps the active draft rather than remounting and discarding input.
    return (
      <AgentHome
        backend={backend}
        sessionId={activeSession.internalId}
        chatInputId={activeSession.chatInputId}
        manager={manager}
        plugin={plugin}
        onSaveChat={onSaveChat}
        updateUserMessageHistory={updateUserMessageHistory}
      />
    );
  }

  // No active session (binary missing, booting, or boot error). The agent
  // select view is a *cold-start* surface, so it takes the pane over only when
  // nothing is actively erroring and the agent that would run isn't set up —
  // the mirror image of the auto-spawn gate above. Two states deliberately keep
  // the compact card instead:
  //  - any `lastError`: a crashed agent, expired credentials, or a failed resume
  //    is a runtime failure, not "no agent is set up". Replacing a working
  //    panel with a setup screen would misdiagnose it, and the card's Retry /
  //    Configure action is the fix. `lastError` therefore wins when both are
  //    true — `AgentModeStatus` still checks install state first internally, so
  //    an absent backend keeps its Install call to action there.
  //  - `checking`: transient and Claude-only. Flashing the select view and
  //    swapping it out is worse than the one-line "Checking … version…".
  const isColdStart =
    !manager.getIsStarting() &&
    manager.getLastError() === null &&
    (installState.kind === "absent" ||
      installState.kind === "incompatible" ||
      installState.kind === "error");

  if (isColdStart) {
    return (
      <AgentSelectPane controls={<AgentChatControls />}>
        <AgentSelectPanel plugin={plugin} manager={manager} />
      </AgentSelectPane>
    );
  }

  // Render the chain switcher below the status surface so the user can still
  // leave Agent Mode without going through settings or the command palette.
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex-1" />
      <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
      <AgentChatControls />
    </div>
  );
};
