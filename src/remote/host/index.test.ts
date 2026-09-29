import type { App } from "obsidian";
import { createRemoteClient, CLIENT_DESKTOPS_SECRET_KEY } from "@/remote/client";
import { createPortSlot, createRemoteHost, HOST_DEVICES_SECRET_KEY } from "@/remote/host";
import { KeychainService } from "@/services/keychainService";

const VAULT_ID = "3f9a1c2e";

function makeApp() {
  const secrets = new Map<string, string>();
  const localStorage = new Map<string, string>();
  const app = {
    vault: { getName: () => "Work notes", adapter: {} },
    secretStorage: {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => void secrets.set(id, value),
      deleteSecret: (id: string) => void secrets.delete(id),
      listSecrets: () => [...secrets.keys()],
    },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, value: string | null) => {
      if (value === null) localStorage.delete(key);
      else localStorage.set(key, value);
    },
  } as unknown as App;
  return { app, secrets, localStorage };
}

describe("remote/host index", () => {
  beforeEach(() => {
    KeychainService.resetInstance();
  });

  describe("createPortSlot()", () => {
    it("returns null until a port was saved", () => {
      const { app } = makeApp();

      expect(createPortSlot(app).load()).toBeNull();
    });

    it("returns the port that was saved on this device", () => {
      const { app } = makeApp();
      const slot = createPortSlot(app);

      slot.save(52341);

      expect(slot.load()).toBe(52341);
    });

    it("keeps the port in device-local storage rather than in synced settings", () => {
      const { app, localStorage } = makeApp();

      createPortSlot(app).save(52341);

      expect([...localStorage.values()]).toEqual(["52341"]);
    });

    it.each(["abc", "80", "70000", "12.5", ""])(
      "ignores a stored value of %j that is not a usable port",
      (stored) => {
        const { app, localStorage } = makeApp();
        localStorage.set("copilot-remote-port:v1", stored);

        expect(createPortSlot(app).load()).toBeNull();
      }
    );
  });

  describe("createRemoteHost()", () => {
    it("builds a service that starts idle: no paired device, nothing listening", () => {
      const { app } = makeApp();
      KeychainService.getInstance(app).setVaultId(VAULT_ID);

      const host = createRemoteHost(app);

      expect(host.getState()).toMatchObject({ listening: false, pairing: null, devices: [] });
      return host.dispose();
    });
  });

  describe("secret keys", () => {
    it("stores the desktop's device list and the phone's desktop list under different keychain entries so a shared keychain never mixes them (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", () => {
      const { app, secrets } = makeApp();
      const keychain = KeychainService.getInstance(app);
      keychain.setVaultId(VAULT_ID);

      keychain.setSecret(HOST_DEVICES_SECRET_KEY, "host-list");
      keychain.setSecret(CLIENT_DESKTOPS_SECRET_KEY, "phone-list");

      expect(HOST_DEVICES_SECRET_KEY).not.toBe(CLIENT_DESKTOPS_SECRET_KEY);
      expect(secrets.size).toBe(2);
      expect(keychain.getSecret(HOST_DEVICES_SECRET_KEY)).toBe("host-list");
      expect(keychain.getSecret(CLIENT_DESKTOPS_SECRET_KEY)).toBe("phone-list");
    });

    it("scopes both entries to the synced vault id so a phone offers only desktops paired for the open vault", () => {
      const { app, secrets } = makeApp();
      const keychain = KeychainService.getInstance(app);
      keychain.setVaultId(VAULT_ID);
      const phone = createRemoteClient(app);

      phone.store.add({
        id: "d",
        host: "100.64.0.1",
        port: 5000,
        token: "t",
        desktopName: "Mac",
        vaultName: "Work",
        pairedAt: 1,
      });

      expect([...secrets.keys()]).toEqual([expect.stringContaining(`copilot-v${VAULT_ID}-`)]);
      keychain.setVaultId("a1b2c3d4");
      expect(createRemoteClient(app).store.list()).toEqual([]);
    });
  });
});
