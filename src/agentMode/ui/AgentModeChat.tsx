import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentSelectPanel } from "@/agentMode/ui/AgentSelectPanel";
import { AgentSelectPane } from "@/agentMode/ui/AgentSelectPane";
import {
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React from "react";

/** See AGENTS.md → "Referential stability". */
const EMPTY_CHAT_INPUT_IDS: readonly string[] = Object.freeze([]);

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
  const auth = useBackendAuthState(descriptor);
  const awaitingAuth = Boolean(
    installState.kind === "ready" && descriptor.auth && auth.status === null
  );
  const signedOut = Boolean(descriptor.auth && auth.status?.signedIn === false);
  const settings = useSettingsValue();
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
    if (!preloadReady || awaitingAuth || signedOut) return;
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
  }, [manager, installState.kind, preloadReady, awaitingAuth, signedOut, tick]);

  const handleInstall = React.useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  // Compose drafts live here rather than in `AgentHome`: a backend restart
  // closes the old session before its replacement exists, and AgentHome
  // unmounts while there is no active session. This component stays mounted
  // across that gap, during which `activeChatInputId` is null.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/473
  const activeChatInputId = manager?.getActiveSession()?.chatInputId ?? null;
  const liveChatInputIds = manager?.getLiveChatInputIds() ?? EMPTY_CHAT_INPUT_IDS;
  const draft = useAgentInputDrafts({
    activeChatInputId,
    liveChatInputIds,
    defaultIncludeActiveNote: settings.autoAddActiveContentToContext === true,
  });

  if (!manager) return null;

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
        draft={draft}
        manager={manager}
        plugin={plugin}
        onSaveChat={onSaveChat}
        updateUserMessageHistory={updateUserMessageHistory}
      />
    );
  }

  // Known setup failures must remain actionable even when model discovery or a
  // previous startup has failed. Managed updates retain their progress/Retry card.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
  const cannotLaunch =
    installState.kind === "absent" ||
    installState.kind === "error" ||
    (installState.kind === "incompatible" && installState.source === "custom") ||
    (installState.kind === "ready" && signedOut);

  if (cannotLaunch) {
    return (
      <AgentSelectPane controls={<AgentChatControls />}>
        <AgentSelectPanel plugin={plugin} manager={manager} />
      </AgentSelectPane>
    );
  }

  // Loading must never hide a surviving conversation or a known setup failure.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
  if (!preloadReady || awaitingAuth) {
    return (
      <div className="tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted">
        {awaitingAuth ? "Checking agent sign-in…" : "Loading agent models…"}
      </div>
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
