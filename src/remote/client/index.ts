import { Platform } from "obsidian";
import { KeychainService } from "@/services/keychainService";
import { PairedDesktopStore } from "@/remote/client/PairedDesktopStore";
import { RemoteClient } from "@/remote/client/RemoteClient";
import { v4 as uuidv4 } from "uuid";

export { RemoteClient } from "@/remote/client/RemoteClient";
export type { PairedDesktop } from "@/remote/client/PairedDesktopStore";

// Distinct from the desktop's key: a desktop and a phone can share one OS keychain and one synced
// vault id. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const CLIENT_DESKTOPS_SECRET_KEY = "remoteClientDesktops";

export function describeThisDevice(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
  if (Platform.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android phone";
  return "Obsidian mobile";
}

export function createRemoteClient(): RemoteClient {
  const keychain = KeychainService.getInstance();
  return new RemoteClient({
    store: new PairedDesktopStore({
      read: () => keychain.getSecret(CLIENT_DESKTOPS_SECRET_KEY),
      write: (value) => keychain.setSecret(CLIENT_DESKTOPS_SECRET_KEY, value),
    }),
    vaultId: keychain.getVaultId(),
    deviceName: describeThisDevice(),
    createId: uuidv4,
  });
}
