import { Platform, type App } from "obsidian";
import { KeychainService } from "@/services/keychainService";
import { PairedDesktopStore } from "@/remote/client/PairedDesktopStore";
import { confirmPairing } from "@/remote/client/confirmPairing";
import { RemoteClient } from "@/remote/client/RemoteClient";
import { v4 as uuidv4 } from "uuid";

export { RemoteClient } from "@/remote/client/RemoteClient";
export type { PairedDesktop } from "@/remote/client/PairedDesktopStore";

// Distinct from the desktop's key: a desktop and a phone can share one OS keychain and one synced
// vault id. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const CLIENT_DESKTOPS_SECRET_KEY = "remoteClientDesktops";

// A random id kept in this device's local storage, never synced and never derived from hardware.
// The desktop uses it to replace this phone's earlier pairing instead of listing the phone twice.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const CLIENT_ID_STORAGE_KEY = "copilot-remote-client-id:v1";

/**
 * Returns this phone's stable pairing id, creating and saving one on first use. When local storage
 * cannot be read or written the id lasts for this session only, so a pairing is never blocked.
 *
 * @param app - The Obsidian app whose local storage holds the id for the open vault.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export function loadClientId(app: App): string {
  try {
    const saved: unknown = app.loadLocalStorage(CLIENT_ID_STORAGE_KEY);
    if (typeof saved === "string" && saved !== "") return saved;
    const created = uuidv4();
    app.saveLocalStorage(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return uuidv4();
  }
}

export function describeThisDevice(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
  if (Platform.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android phone";
  return "Obsidian mobile";
}

export function createRemoteClient(app: App): RemoteClient {
  const keychain = KeychainService.getInstance();
  return new RemoteClient({
    store: new PairedDesktopStore({
      read: () => keychain.getSecret(CLIENT_DESKTOPS_SECRET_KEY),
      write: (value) => keychain.setSecret(CLIENT_DESKTOPS_SECRET_KEY, value),
    }),
    vaultId: keychain.getVaultId(),
    vaultName: app.vault.getName(),
    deviceName: describeThisDevice(),
    clientId: loadClientId(app),
    confirmPairing: (details) => confirmPairing(app, details),
    createId: uuidv4,
  });
}
