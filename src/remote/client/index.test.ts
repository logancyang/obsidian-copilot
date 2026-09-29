import { Platform } from "obsidian";
import { createRemoteClient, describeThisDevice } from "@/remote/client";
import { KeychainService } from "@/services/keychainService";

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
      const client = createRemoteClient();

      client.store.add({
        id: "d",
        host: "100.64.0.1",
        port: 5000,
        token: "t",
        desktopName: "Mac",
        vaultName: "Work",
        pairedAt: 1,
      });

      expect(createRemoteClient().store.list()).toHaveLength(1);
      expect([...secrets.keys()][0]).toContain("copilot-v3f9a1c2e-");
    });

    it("refuses a pairing link for a vault other than the one the phone has open", async () => {
      installKeychain("3f9a1c2e");
      const client = createRemoteClient();

      const outcome = await client.pairFromLink(
        "obsidian://copilot-pair?host=100.64.0.1&port=5000&vault=Other&vaultId=deadbeef&secret=abcdefghijklmnopqrstuv"
      );

      expect(outcome).toEqual({ ok: false, reason: "wrong-vault", vaultName: "Other" });
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
