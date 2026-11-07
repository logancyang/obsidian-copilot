import { CONNECTOR_SERVICES } from "@/connectors/catalog";
import type { ConnectionManager, WaitingLogin } from "@/connectors/connectionManager";
import type { ConnectorTools } from "@/connectors/connectorTools";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import type { LoginOutcome } from "@/connectors/oauth/connectorAuth";
import { BrowseConnectors, type BrowseConnectorsProps } from "@/connectors/ui/BrowseConnectors";
import { ConnectedConnectors } from "@/connectors/ui/ConnectedConnectors";
import { ConnectorsUpsell } from "@/connectors/ui/ConnectorsUpsell";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { useTab } from "@/contexts/TabContext";
import { navigateToPlusPage } from "@/plusUtils";
import { err2String } from "@/utils";
import { Notice } from "obsidian";
import { useSettingsSubPage } from "@/settings/v2/SettingsSubPage";
import React, { useEffect, useRef } from "react";
import { DesktopOnlySettingsPanel } from "./DesktopOnlySettingsPanel";

export const ConnectorsSettings: React.FC = () => {
  const { connectionManager, connectorTools } = usePlugin();
  if (!connectionManager || !connectorTools) {
    return <DesktopOnlySettingsPanel message="Connectors are available on desktop." />;
  }
  return <ConnectorsPanel manager={connectionManager} tools={connectorTools} />;
};

interface ConnectorsPanelProps {
  manager: ConnectionManager;
  tools: ConnectorTools;
}

function ConnectorsPanel({ manager, tools }: ConnectorsPanelProps): React.ReactElement | null {
  const app = useApp();
  const { setSelectedTab } = useTab();
  const snapshot = useConnectorsSnapshot(manager);
  const enabled = useIsConnectorsEnabled();
  const subPage = useSettingsSubPage();
  const loginStartedHere = useRef<WaitingLogin | null>(null);

  useEffect(
    () => () => {
      // A login nobody can see would block every other Connect, including a chat card's, until it times out.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/858
      loginStartedHere.current?.cancel();
      manager.dismissFailedLogin();
    },
    [manager]
  );

  if (enabled === false) {
    return (
      <ConnectorsUpsell
        onEnterLicenseKey={() => setSelectedTab("basic")}
        onSeePlans={() => navigateToPlusPage("connectors_settings")}
      />
    );
  }
  if (!snapshot) return null;

  const startLogin = async (login: () => Promise<LoginOutcome>) => {
    if (!(await ensureConnectorsEntitlement(app))) return;
    const outcome = login();
    loginStartedHere.current = manager.getSnapshot().waitingLogin;
    await outcome;
  };
  const runLogin = (login: () => Promise<LoginOutcome>) => {
    startLogin(login).catch((error) => new Notice(err2String(error)));
  };
  const serviceIdOf = (connectionId: string) =>
    snapshot.connections.find(({ id }) => id === connectionId)?.serviceId ?? "";
  const connect = (serviceId: string) => runLogin(() => manager.connect(serviceId));
  const reconnect = (connectionId: string) => runLogin(() => manager.reconnect(connectionId));
  const openBrowse = () => {
    manager.dismissFailedLogin();
    subPage.open(
      <BrowsePage
        manager={manager}
        onBack={() => {
          manager.dismissFailedLogin();
          subPage.close();
        }}
        onConnect={connect}
        onReconnect={reconnect}
      />
    );
  };

  return (
    <ConnectedConnectors
      snapshot={snapshot}
      onBrowse={openBrowse}
      onConnect={connect}
      onReconnect={reconnect}
      onCheckAgain={(connectionId) => tools.checkAgain(connectionId)}
      onDisconnect={(connectionId) => {
        const service = CONNECTOR_SERVICES.get(serviceIdOf(connectionId));
        if (!service) return;
        new ConfirmModal(
          app,
          () => manager.disconnect(connectionId),
          `Agents lose access to ${service.name} on all your devices, and Copilot signs out of it. You can connect it again anytime.`,
          `Disconnect ${service.name}?`,
          "Disconnect",
          "Cancel",
          undefined,
          "destructive"
        ).open();
      }}
    />
  );
}

interface BrowsePageProps extends Omit<BrowseConnectorsProps, "snapshot"> {
  manager: ConnectionManager;
}

function BrowsePage({ manager, ...props }: BrowsePageProps): React.ReactElement | null {
  const snapshot = useConnectorsSnapshot(manager);
  return snapshot && <BrowseConnectors snapshot={snapshot} {...props} />;
}
