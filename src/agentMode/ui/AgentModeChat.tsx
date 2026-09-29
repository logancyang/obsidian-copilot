import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentSelectPanel } from "@/agentMode/ui/AgentSelectPanel";
import { AgentSelectPane } from "@/agentMode/ui/AgentSelectPane";
import {
  useBackendInstallState,
  useManagedInstallActionState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

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
    installState.kind === "ready" && descriptor.auth && (auth.checking || auth.status === null)
  );
  const signedOut = Boolean(descriptor.auth && auth.status?.signedIn === false);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const preloadReady = manager?.isPreloadReady(descriptor.id) ?? true;

  React.useEffect(() => {
    if (!manager) return;
    if (!preloadReady || managedInstall.kind === "running" || awaitingAuth || signedOut) return;
    if (manager.getSessionsForScope(manager.getActiveProjectId()).length > 0) return;
    if (manager.getIsStarting() || manager.isRestoringOpenChats()) return;
    if (manager.getLastError()) return;
    if (installState.kind !== "ready") return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
  }, [
    manager,
    installState.kind,
    preloadReady,
    managedInstall.kind,
    awaitingAuth,
    signedOut,
    tick,
  ]);

  const handleInstall = React.useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  if (!manager) return null;

  const activeSession = manager.getActiveSession();
  const backend = manager.getActiveChatUIState();
  if (activeSession && backend) {
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

  // The prior supported installation can still report ready during its update.
  // Show the shared download before model loading or creating a fresh chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/530
  if (managedInstall.kind === "running") {
    return (
      <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
        <div className="tw-flex-1" />
        <AgentStatusCard
          summary={`Updating ${descriptor.displayName}…`}
          message={managedInstall.label}
          progress={{ percent: managedInstall.percent }}
        />
        <AgentChatControls />
      </div>
    );
  }

  // Known setup failures must remain actionable even when model discovery or a
  // previous startup has failed. Managed updates retain their progress/Retry card.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/532
  const cannotLaunch =
    installState.kind === "absent" ||
    installState.kind === "error" ||
    (installState.kind === "incompatible" &&
      (installState.source === "custom" || !descriptor.managedInstall)) ||
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

  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex-1" />
      <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
      <AgentChatControls />
    </div>
  );
};
