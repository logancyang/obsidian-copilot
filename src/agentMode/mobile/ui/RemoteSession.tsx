import { RemoteConnectionBanner } from "@/agentMode/mobile/ui/RemoteConnectionBanner";
import { RemoteConnectionScreen } from "@/agentMode/mobile/ui/RemoteConnectionScreen";
import { RemoteEmptyState } from "@/agentMode/mobile/ui/RemoteEmptyState";
import { RemoteHeader } from "@/agentMode/mobile/ui/RemoteHeader";
import type { RemoteSessionRuntime } from "@/agentMode/mobile/remoteSessionRuntime";
import { deriveRemoteStatus } from "@/agentMode/mobile/remoteStatus";
import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { useClientView } from "@/agentMode/protocol/react";
import { EMPTY_CHAT_RUNTIME } from "@/agentMode/protocol/selectors";
import type { TabSummary } from "@/agentMode/protocol/state";
import { AgentPaneCapabilitiesProvider } from "@/agentMode/ui/AgentPaneContext";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useChatInputAutoFocus } from "@/agentMode/ui/hooks/useChatInputAutoFocus";
import { useChatRuntime } from "@/agentMode/ui/hooks/useChatRuntime";
import { useTabCommands } from "@/agentMode/ui/hooks/useTabCommands";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useSettingsValue } from "@/settings/model";
import { Notice, type App } from "obsidian";
import React, { useCallback, useMemo, useSyncExternalStore } from "react";

export interface RemoteSessionProps {
  runtime: RemoteSessionRuntime;
  app: App;
  desktopName: string;
  appVersion: string;
  updateUserMessageHistory: (message: string) => void;
  onSwitchDesktop?: () => void;
}

interface RemoteChatProps {
  runtime: RemoteSessionRuntime;
  tab: TabSummary;
  app: App;
  updateUserMessageHistory: (message: string) => void;
}

const RemoteChat: React.FC<RemoteChatProps> = ({ runtime, tab, app, updateUserMessageHistory }) => {
  const { client, view, drafts } = runtime;
  const settings = useSettingsValue();
  const draft = useAgentInputDrafts({
    store: drafts,
    chatInputId: tab.chatInputId,
    defaultIncludeActiveNote: settings.autoAddActiveContentToContext === true,
  });
  useChatInputAutoFocus();
  const { isTurnInFlight } = useChatRuntime(client, tab.id) ?? EMPTY_CHAT_RUNTIME;

  return (
    <>
      <AgentChatMessages
        key={tab.id}
        client={client}
        sessionId={tab.id}
        app={app}
        isLoading={draft.loading || isTurnInFlight}
      />
      <AgentChatInput
        client={client}
        view={view}
        sessionId={tab.id}
        chatInputId={tab.chatInputId}
        draft={draft}
        app={app}
        updateUserMessageHistory={updateUserMessageHistory}
      />
    </>
  );
};

interface RemotePaneProps extends RemoteSessionProps {
  live: boolean;
}

const RemotePane: React.FC<RemotePaneProps> = ({
  runtime,
  app,
  desktopName,
  updateUserMessageHistory,
  live,
}) => {
  const { client, view } = runtime;
  const { host, activeTab } = useClientView(client, view);
  const tabs = useTabCommands(client, view);
  const isCreating = host?.host.startingBackendId != null;

  const start = useCallback(() => {
    void tabs.createTab().then((result) => {
      if (!result.ok) new Notice(`${desktopName} could not start a session. Try again.`);
    });
  }, [tabs, desktopName]);

  return (
    <>
      <AgentTabStrip client={client} view={view} />
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        {activeTab ? (
          <RemoteChat
            runtime={runtime}
            tab={activeTab}
            app={app}
            updateUserMessageHistory={updateUserMessageHistory}
          />
        ) : (
          <RemoteEmptyState
            desktopName={desktopName}
            creating={isCreating || !live}
            onStart={start}
          />
        )}
      </div>
    </>
  );
};

export const RemoteSession: React.FC<RemoteSessionProps> = (props) => {
  const { runtime, desktopName, appVersion, onSwitchDesktop } = props;
  const { client, transport } = runtime;
  const subscribeClient = useCallback(
    (listener: () => void) => client.subscribe(listener),
    [client]
  );
  const link = useSyncExternalStore(transport.subscribeLink, transport.getLinkState);
  const connection = useSyncExternalStore(subscribeClient, () => client.getConnection());
  const hasReplica = useSyncExternalStore(subscribeClient, () => client.getHost() !== null);
  const remote = useSyncExternalStore(subscribeClient, () => client.getHostVersion());
  const local = useMemo(() => ({ app: appVersion, protocol: PROTOCOL_VERSION }), [appVersion]);
  const status = useMemo(
    () => deriveRemoteStatus({ link, connection, hasReplica, local, remote }),
    [link, connection, hasReplica, local, remote]
  );
  const retry = useCallback(() => transport.reconnectNow(), [transport]);

  if (status.screen) {
    return (
      <RemoteConnectionScreen
        screen={status.screen}
        desktopName={desktopName}
        onRetry={retry}
        onSwitchDesktop={onSwitchDesktop}
      />
    );
  }

  return (
    <AgentPaneCapabilitiesProvider value={runtime.capabilities}>
      <ChatInputProvider>
        <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <RemoteHeader
            desktopName={desktopName}
            live={status.banner === null}
            onSwitchDesktop={onSwitchDesktop}
          />
          {status.banner && (
            <RemoteConnectionBanner
              banner={status.banner}
              desktopName={desktopName}
              onRetry={retry}
            />
          )}
          <RemotePane {...props} live={connection === "live"} />
        </div>
      </ChatInputProvider>
    </AgentPaneCapabilitiesProvider>
  );
};
