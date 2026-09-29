import type { App } from "obsidian";
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
    it("stores the paired-device list in the Obsidian keychain, scoped to the synced vault id", () => {
      const { app, secrets } = makeApp();
      const keychain = KeychainService.getInstance(app);
      keychain.setVaultId(VAULT_ID);
      keychain.setSecret(HOST_DEVICES_SECRET_KEY, "host-list");

      expect([...secrets.keys()]).toEqual([
        expect.stringContaining(`copilot-v${VAULT_ID}-remote-host-devices`),
      ]);
    });

    it("builds a service that starts idle: no paired device, nothing listening", () => {
      const { app } = makeApp();
      KeychainService.getInstance(app).setVaultId(VAULT_ID);

      const host = createRemoteHost(app);

      expect(host.getState()).toMatchObject({ listening: false, pairing: null, devices: [] });
      return host.dispose();
    });
  });
});
