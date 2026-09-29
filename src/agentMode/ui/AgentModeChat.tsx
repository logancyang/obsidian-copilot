import type { ClientView } from "@/agentMode/protocol/ClientView";
import { useClientView } from "@/agentMode/protocol/react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
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

export const AgentModeChat: React.FC<Props> = (props) => {
  const {
    agentSessionManager: manager,
    agentSessionClient: client,
    agentSessionView: view,
  } = props.plugin;
  if (!manager || !client || !view) return null;
  return <AgentModeChatBody {...props} manager={manager} client={client} view={view} />;
};

interface BodyProps extends Props {
  manager: AgentSessionManager;
  client: SessionClient;
  view: ClientView;
}

const AgentModeChatBody: React.FC<BodyProps> = ({
  plugin,
  manager,
  client,
  view,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);
  const awaitingAuth = Boolean(
    installState.kind === "ready" && descriptor.auth && (auth.checking || auth.status === null)
  );
  const signedOut = Boolean(descriptor.auth && auth.status?.signedIn === false);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const { host, activeTab, scopeTabs } = useClientView(client, view);
  const isStarting = host?.host.startingBackendId != null;
  const startFailed = host?.host.startFailed ?? false;
  const preloadReady =
    host?.backends.find((backend) => backend.id === descriptor.id)?.preload !== "pending";
  const scopeTabCount = scopeTabs.length;

  React.useEffect(() => {
    if (!preloadReady || managedInstall.kind === "running" || awaitingAuth || signedOut) return;
    if (scopeTabCount > 0 || isStarting || startFailed) return;
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
    scopeTabCount,
    isStarting,
    startFailed,
  ]);

  const handleInstall = React.useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  if (activeTab) {
    return (
      <AgentHome
        client={client}
        view={view}
        sessionId={activeTab.id}
        chatInputId={activeTab.chatInputId}
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
