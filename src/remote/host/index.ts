import type { App } from "obsidian";
import { KeychainService } from "@/services/keychainService";
import { isPlusEnabled } from "@/plusUtils";
import { subscribeToSettingsChange } from "@/settings/model";
import { PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteHostService, type RemoteHostServiceDeps } from "@/remote/host/RemoteHostService";
import { readTailscaleAddress } from "@/remote/host/tailscaleAddress";
import { requireNodeModule } from "@/utils/desktopRuntime";

export { RemoteHostService } from "@/remote/host/RemoteHostService";
export type { RemoteConnection } from "@/remote/host/RemoteServer";

// The desktop and phone roles use different secret keys because both can share one OS keychain
// and one synced vault id. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const HOST_DEVICES_SECRET_KEY = "remoteHostDevices";
const PORT_STORAGE_KEY = "copilot-remote-port:v1";
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export function createPortSlot(app: App): RemoteHostServiceDeps["port"] {
  return {
    load: () => {
      const stored = Number(app.loadLocalStorage(PORT_STORAGE_KEY));
      return Number.isInteger(stored) && stored >= MIN_PORT && stored <= MAX_PORT ? stored : null;
    },
    save: (port) => app.saveLocalStorage(PORT_STORAGE_KEY, String(port)),
  };
}

export function createRemoteHost(app: App): RemoteHostService {
  const keychain = KeychainService.getInstance();
  const os = requireNodeModule<typeof import("node:os")>("os");
  return new RemoteHostService({
    store: new PairedDeviceStore({
      read: () => keychain.getSecret(HOST_DEVICES_SECRET_KEY),
      write: (value) => keychain.setSecret(HOST_DEVICES_SECRET_KEY, value),
    }),
    pairing: new PairingWindow(),
    isPlus: isPlusEnabled,
    subscribePlus: (listener) => subscribeToSettingsChange(() => listener()),
    findTailscaleAddress: readTailscaleAddress,
    vault: { name: app.vault.getName(), id: keychain.getVaultId() },
    desktopName: os.hostname(),
    port: createPortSlot(app),
  });
}
