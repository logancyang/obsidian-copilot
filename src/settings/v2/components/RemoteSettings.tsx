import { usePlugin } from "@/contexts/PluginContext";
import { navigateToPlusPage } from "@/plusUtils";
import { describePairOutcome } from "@/remote/client/pairMessages";
import type { PairedDesktopView } from "@/remote/ui/RemoteClientPanel";
import { RemoteClientPanel } from "@/remote/ui/RemoteClientPanel";
import { RemoteHostPanel } from "@/remote/ui/RemoteHostPanel";
import type { RemoteClient } from "@/remote/client";
import type { RemoteHostService } from "@/remote/host";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { DesktopOnlySettingsPanel } from "./DesktopOnlySettingsPanel";

const DesktopRemote: React.FC<{ host: RemoteHostService }> = ({ host }) => {
  const state = useSyncExternalStore(host.subscribe, host.getState);

  useEffect(() => {
    void host.recheck();
  }, [host]);

  const copyLink = useCallback((link: string) => {
    navigator.clipboard.writeText(link).then(
      () => new Notice("Pairing link copied."),
      () => new Notice("Copilot could not copy the pairing link.")
    );
  }, []);

  return (
    <RemoteHostPanel
      state={state}
      onStartPairing={() => void host.startPairing()}
      onCancelPairing={() => host.cancelPairing()}
      onCopyLink={copyLink}
      onRevoke={(deviceId) => host.revokeDevice(deviceId)}
      onRecheck={() => void host.recheck()}
      onUpgrade={() => navigateToPlusPage("settings")}
    />
  );
};

const PhoneRemote: React.FC<{ client: RemoteClient }> = ({ client }) => {
  const desktops = useSyncExternalStore(client.store.subscribe, client.store.list);
  const views = useMemo<readonly PairedDesktopView[]>(
    () =>
      desktops.map((desktop) => ({
        id: desktop.id,
        desktopName: desktop.desktopName,
        vaultName: desktop.vaultName,
        address: `${desktop.host}:${desktop.port}`,
      })),
    [desktops]
  );

  const pairFromLink = useCallback(
    async (link: string) => describePairOutcome(await client.pairFromLink(link)),
    [client]
  );

  const testConnection = useCallback(
    async (id: string) => {
      const desktop = client.store.list().find((candidate) => candidate.id === id);
      if (!desktop) return "This desktop is no longer paired.";
      const outcome = await client.connect(desktop);
      if (outcome.ok) {
        outcome.channel.close();
        return `Connected to ${desktop.desktopName}.`;
      }
      // A revoked phone keeps its saved token, so the person is told to remove and pair again
      // instead of retrying. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      if (outcome.reason === "token-rejected") {
        return "The desktop no longer accepts this phone. Remove it here and pair again.";
      }
      return describePairOutcome({ ok: false, reason: outcome.reason });
    },
    [client]
  );

  return (
    <RemoteClientPanel
      desktops={views}
      onPairFromLink={pairFromLink}
      onTestConnection={testConnection}
      onRemove={(id) => client.store.remove(id)}
    />
  );
};

export const RemoteSettings: React.FC = () => {
  const plugin = usePlugin();
  if (isDesktopRuntime()) {
    return plugin.remoteHost ? (
      <DesktopRemote host={plugin.remoteHost} />
    ) : (
      <DesktopOnlySettingsPanel message="Remote access could not start. Reload Obsidian to retry." />
    );
  }
  return plugin.remoteClient ? (
    <PhoneRemote client={plugin.remoteClient} />
  ) : (
    <DesktopOnlySettingsPanel message="Remote access is unavailable in this session." />
  );
};
