import AgentChat from "@/agentMode/ui/AgentChat";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import {
  useActiveBackendDescriptor,
  useBackendInstallState,
} from "@/agentMode/ui/useBackendDescriptor";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

/**
 * Agent Mode chat surface. Owns session-manager subscription, auto-spawn of the
 * first session on mount, and the no-session fallback (status pill + minimal
 * controls). Mounted by `CopilotAgentView` (the dedicated agent pane), so this
 * component is only rendered when the agent view is open.
 */
export const AgentModeChat: React.FC<Props> = ({
  plugin,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const manager = plugin.agentSessionManager;
  const descriptor = useActiveBackendDescriptor();
  const installState = useBackendInstallState(descriptor);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  // Manager fires `notify()` on preload settle, which bumps `tick` above and
  // re-renders this component — so we can read the flag directly each render.
  const preloadReady = manager?.isPreloadReady() ?? true;

  // Auto-spawn the first session on mount. The manager de-dupes concurrent
  // creators via creatingSession, so this is safe to fire whenever the
  // dependencies change. Skip if the backend isn't installed (the install
  // pill takes over), there's a prior boot error (Retry handles it), or
  // preload hasn't settled (the SDK catalog isn't in cache yet — kicking
  // off `newSession` would trigger a redundant on-demand probe).
  React.useEffect(() => {
    if (!manager) return;
    if (!preloadReady) return;
    if (manager.getSessions().length > 0) return;
    if (manager.getIsStarting()) return;
    if (manager.getLastError()) return;
    if (installState.kind === "absent") return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
    // tick forces re-evaluation when the manager's pool changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        Loading agent models…
      </div>
    );
  }

  const activeSession = manager.getActiveSession();
  const backend = manager.getActiveChatUIState();
  if (activeSession && backend) {
    return (
      <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
        <AgentTabStrip manager={manager} />
        {/* key by session id so React remounts AgentChat on tab switch —
            this rebinds input/loading state and re-runs the backend
            subscribe effect against the new session. */}
        <div className="tw-min-h-0 tw-flex-1">
          <AgentChat
            key={activeSession.internalId}
            backend={backend}
            manager={manager}
            plugin={plugin}
            onSaveChat={onSaveChat}
            updateUserMessageHistory={updateUserMessageHistory}
          />
        </div>
      </div>
    );
  }

  // No active session (binary missing, booting, or boot error). Render the
  // chain switcher above the status pill so the user can still leave Agent
  // Mode without going through settings or the command palette.
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex-1" />
      <AgentModeStatus manager={manager} onInstallClick={handleInstall} />
      <AgentChatControls />
    </div>
  );
};
