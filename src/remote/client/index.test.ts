import { Platform } from "obsidian";
import {
  CLIENT_ID_STORAGE_KEY,
  createRemoteClient,
  describeThisDevice,
  loadClientId,
} from "@/remote/client";
import type { App } from "obsidian";
import { KeychainService } from "@/services/keychainService";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

function makeApp(initial: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initial));
  const app = {
    vault: { getName: () => "Work notes" },
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: string) => void storage.set(key, value),
  } as unknown as App;
  return { app, storage };
}

function installKeychain(vaultId: string) {
  const secrets = new Map<string, string>();
  const keychain = KeychainService.getInstance({
    vault: { adapter: {} },
    secretStorage: {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => void secrets.set(id, value),
      deleteSecret: (id: string) => void secrets.delete(id),
    },
  } as never);
  keychain.setVaultId(vaultId);
  return secrets;
}

describe("remote/client index", () => {
  beforeEach(() => KeychainService.resetInstance());

  describe("createRemoteClient()", () => {
    it("persists paired desktops in the Obsidian keychain scoped to the open vault", () => {
      const secrets = installKeychain("3f9a1c2e");
      const client = createRemoteClient(makeApp().app);

      client.store.add({
        id: "d",
        host: "100.64.0.1",
        port: 5000,
        token: "t",
        desktopName: "Mac",
        vaultName: "Work",
        pairedAt: 1,
      });

      expect(createRemoteClient(makeApp().app).store.list()).toHaveLength(1);
      expect([...secrets.keys()][0]).toContain("copilot-v3f9a1c2e-");
    });

    it("refuses a pairing link for a vault other than the one the phone has open", async () => {
      installKeychain("3f9a1c2e");
      const client = createRemoteClient(makeApp().app);

      const outcome = await client.pairFromLink(
        "obsidian://copilot-pair?host=100.64.0.1&port=5000&vault=Other&vaultId=deadbeef&secret=abcdefghijklmnopqrstuv"
      );

      expect(outcome).toEqual({ ok: false, reason: "wrong-vault", vaultName: "Other" });
    });
  });

  describe("loadClientId()", () => {
    it(`creates a random id on first use and returns the same one afterwards (${ISSUE})`, () => {
      const { app, storage } = makeApp();

      const first = loadClientId(app);

      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      expect(storage.get(CLIENT_ID_STORAGE_KEY)).toBe(first);
      expect(loadClientId(app)).toBe(first);
    });

    it(`keeps the id a previous session saved (${ISSUE})`, () => {
      const { app } = makeApp({ [CLIENT_ID_STORAGE_KEY]: "saved-id" });

      expect(loadClientId(app)).toBe("saved-id");
    });

    it(`still returns an id for this session when local storage throws (${ISSUE})`, () => {
      const app = {
        loadLocalStorage: () => {
          throw new Error("storage unavailable");
        },
        saveLocalStorage: () => {
          throw new Error("storage unavailable");
        },
      } as unknown as App;

      expect(loadClientId(app)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("describeThisDevice()", () => {
    it.each([
      ["an iPhone", { isIosApp: true, isAndroidApp: false, isTablet: false }, "iPhone"],
      ["an iPad", { isIosApp: true, isAndroidApp: false, isTablet: true }, "iPad"],
      [
        "an Android phone",
        { isIosApp: false, isAndroidApp: true, isTablet: false },
        "Android phone",
      ],
      [
        "an Android tablet",
        { isIosApp: false, isAndroidApp: true, isTablet: true },
        "Android tablet",
      ],
      [
        "another mobile runtime",
        { isIosApp: false, isAndroidApp: false, isTablet: false },
        "Obsidian mobile",
      ],
    ])("names %s so the desktop can list which phone paired", (_label, platform, expected) => {
      Object.assign(Platform, platform);

      expect(describeThisDevice()).toBe(expected);
    });
  });
});
