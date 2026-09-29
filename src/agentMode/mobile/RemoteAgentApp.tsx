import { DesktopPicker } from "@/agentMode/mobile/ui/DesktopPicker";
import { RemoteSession } from "@/agentMode/mobile/ui/RemoteSession";
import {
  createRemoteSessionRuntime,
  documentVisibility,
  type RemoteSessionRuntime,
  type RemoteSessionRuntimeDeps,
} from "@/agentMode/mobile/remoteSessionRuntime";
import type { PairedDesktop } from "@/remote/client/PairedDesktopStore";
import type { RemoteClient } from "@/remote/client/RemoteClient";
import type { PairedDesktopView } from "@/remote/ui/RemoteClientPanel";
import type { App } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export interface RemoteAgentAppProps {
  app: App;
  remote: RemoteClient;
  appVersion: string;
  updateUserMessageHistory: (message: string) => void;
  createRuntime?: (deps: RemoteSessionRuntimeDeps) => RemoteSessionRuntime;
}

export const SELECTED_DESKTOP_STORAGE_KEY = "copilot-remote-desktop:v1";

interface DesktopSessionProps extends Omit<RemoteAgentAppProps, "createRuntime"> {
  desktop: PairedDesktop;
  createRuntime: (deps: RemoteSessionRuntimeDeps) => RemoteSessionRuntime;
  onSwitchDesktop?: () => void;
}

// The runtime is created in an effect and disposed by its cleanup, so a component that mounts,
// unmounts and mounts again never leaves a live socket behind a discarded runtime.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const DesktopSession: React.FC<DesktopSessionProps> = ({
  app,
  remote,
  desktop,
  appVersion,
  updateUserMessageHistory,
  createRuntime,
  onSwitchDesktop,
}) => {
  const [runtime, setRuntime] = useState<RemoteSessionRuntime | null>(null);
  useEffect(() => {
    const created = createRuntime({
      app,
      remote,
      desktop,
      appVersion,
      visibility: documentVisibility,
    });
    setRuntime(created);
    return () => {
      created.dispose();
      setRuntime(null);
    };
  }, [app, remote, desktop, appVersion, createRuntime]);

  if (!runtime) return null;
  return (
    <RemoteSession
      runtime={runtime}
      app={app}
      desktopName={desktop.desktopName}
      appVersion={appVersion}
      updateUserMessageHistory={updateUserMessageHistory}
      onSwitchDesktop={onSwitchDesktop}
    />
  );
};

export const RemoteAgentApp: React.FC<RemoteAgentAppProps> = ({
  app,
  remote,
  appVersion,
  updateUserMessageHistory,
  createRuntime = createRemoteSessionRuntime,
}) => {
  const desktops = useSyncExternalStore(remote.store.subscribe, remote.store.list);
  const [chosenId, setChosenId] = useState<string | null>(() => {
    const stored: unknown = app.loadLocalStorage(SELECTED_DESKTOP_STORAGE_KEY);
    return typeof stored === "string" ? stored : null;
  });
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

  const choose = useCallback(
    (id: string | null) => {
      setChosenId(id);
      app.saveLocalStorage(SELECTED_DESKTOP_STORAGE_KEY, id);
    },
    [app]
  );

  const selected = desktops.length === 1 ? desktops[0] : desktops.find((d) => d.id === chosenId);
  if (!selected) return <DesktopPicker desktops={views} onSelect={choose} />;
  return (
    <DesktopSession
      key={selected.id}
      app={app}
      remote={remote}
      desktop={selected}
      appVersion={appVersion}
      updateUserMessageHistory={updateUserMessageHistory}
      createRuntime={createRuntime}
      onSwitchDesktop={desktops.length > 1 ? () => choose(null) : undefined}
    />
  );
};
