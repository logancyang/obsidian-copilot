import { CONNECTOR_SERVICES } from "@/connectors/catalog";
import type { ConnectionManager, WaitingLogin } from "@/connectors/connectionManager";
import type { ConnectorTools } from "@/connectors/connectorTools";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import { editableConfigText, requireOneServer } from "@/connectors/custom/customConnectorConfig";
import type { CustomConnectors } from "@/connectors/custom/customConnectors";
import type { LoginOutcome } from "@/connectors/oauth/connectorAuth";
import { BrowseConnectors, type BrowseConnectorsProps } from "@/connectors/ui/BrowseConnectors";
import { ConnectedConnectors } from "@/connectors/ui/ConnectedConnectors";
import { ConnectorsUpsell } from "@/connectors/ui/ConnectorsUpsell";
import { CustomConnectorModal } from "@/connectors/ui/CustomConnectorModal";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { useTab } from "@/contexts/TabContext";
import { navigateToPlusPage } from "@/plusUtils";
import { err2String } from "@/utils";
import { Notice } from "obsidian";
import { useSettingsSubPage } from "@/settings/v2/SettingsSubPage";
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { DesktopOnlySettingsPanel } from "./DesktopOnlySettingsPanel";

export const ConnectorsSettings: React.FC = () => {
  const { connectionManager, connectorTools, customConnectors } = usePlugin();
  if (!connectionManager || !connectorTools || !customConnectors) {
    return <DesktopOnlySettingsPanel message="Connectors are available on desktop." />;
  }
  return (
    <ConnectorsPanel manager={connectionManager} tools={connectorTools} custom={customConnectors} />
  );
};

interface ConnectorsPanelProps {
  manager: ConnectionManager;
  tools: ConnectorTools;
  custom: CustomConnectors;
}

function ConnectorsPanel({
  manager,
  tools,
  custom,
}: ConnectorsPanelProps): React.ReactElement | null {
  const app = useApp();
  const { setSelectedTab } = useTab();
  const snapshot = useConnectorsSnapshot(manager);
  const { connectors: customConnectors } = useSyncExternalStore(
    custom.subscribe,
    custom.getSnapshot
  );
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
  const addCustom = async () => {
    if (!(await ensureConnectorsEntitlement(app))) return;
    new CustomConnectorModal(app, "Add custom connector", {
      helper:
        "Paste the MCP server config from its README. Values in env and headers stay in this device's keychain.",
      submitLabel: "Add",
      parse: (text) => custom.parse(text),
      onSubmit: (_text, connectors) => custom.add(connectors),
    }).open();
  };
  const customConfigOf = (id: string) =>
    customConnectors.find(({ config }) => config.id === id)?.config;
  const customActions = {
    onEdit: (id: string) => {
      const config = customConfigOf(id);
      if (!config) return;
      new CustomConnectorModal(app, `Edit ${config.name}`, {
        helper: "Leave a value blank to keep the one stored on this device.",
        initialText: editableConfigText(config),
        storedValueNames: custom.storedValueNames(id),
        submitLabel: "Save",
        parse: (text) => requireOneServer(custom.parse(text)),
        onSubmit: (text) => custom.edit(id, text),
      }).open();
    },
    onTryAgain: () => void custom.refresh(),
    onSetTurnedOff: (id: string, off: boolean) => custom.setTurnedOff(id, off),
    onRemove: (id: string) => {
      const config = customConfigOf(id);
      if (!config) return;
      new ConfirmModal(
        app,
        () => custom.remove(id),
        `Agents lose access to ${config.name} on all your devices. You can add it again anytime.`,
        `Remove ${config.name}?`,
        "Remove",
        "Cancel",
        undefined,
        "destructive"
      ).open();
    },
  };
  const openBrowse = () => {
    manager.dismissFailedLogin();
    subPage.open(
      <BrowsePage
        manager={manager}
        onBack={() => {
          manager.dismissFailedLogin();
          subPage.close();
        }}
        onAddCustom={() => void addCustom()}
        onConnect={connect}
        onReconnect={reconnect}
      />
    );
  };

  return (
    <ConnectedConnectors
      snapshot={snapshot}
      customConnectors={customConnectors}
      onBrowse={openBrowse}
      onAddCustom={() => void addCustom()}
      customActions={customActions}
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
