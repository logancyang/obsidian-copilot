jest.mock("@/logger");

// miyoUtils (real) pulls these at module load; stub so importing here is inert.
jest.mock("@/plusUtils", () => ({ isSelfHostModeValidFor: jest.fn() }));
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));
jest.mock("@/utils/deviceId", () => ({ getDeviceId: jest.fn(() => "device-A") }));

// Controllable Miyo client; the class type is erased (type-only imports).
const resolveBaseUrl = jest.fn<Promise<string>, unknown[]>();
const getFolder = jest.fn<Promise<unknown>, unknown[]>();
const checkFolderRegistration = jest.fn<Promise<string>, unknown[]>();
const deleteFolder = jest.fn<Promise<void>, unknown[]>();
const addFolder = jest.fn<Promise<unknown>, unknown[]>();
const scanFolder = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    resolveBaseUrl = (...a: unknown[]) => resolveBaseUrl(...a);
    getFolder = (...a: unknown[]) => getFolder(...a);
    checkFolderRegistration = (...a: unknown[]) => checkFolderRegistration(...a);
    deleteFolder = (...a: unknown[]) => deleteFolder(...a);
    addFolder = (...a: unknown[]) => addFolder(...a);
    scanFolder = (...a: unknown[]) => scanFolder(...a);
  },
}));

const updateSetting = jest.fn<void, unknown[]>();
let currentSettings: Record<string, unknown>;
// Keep the real module (searchUtils needs its normalizeRootFolders); override
// only the settings accessors the resync reads/writes.
jest.mock("@/settings/model", () => ({
  ...jest.requireActual<object>("@/settings/model"),
  getSettings: jest.fn(() => currentSettings),
  updateSetting: (...a: unknown[]) => {
    updateSetting(...a);
  },
}));

jest.mock("@/utils/vaultPath", () => ({ getVaultBase: jest.fn(() => "/abs/vault") }));

import type { App } from "obsidian";
import type { MiyoAddFolderRequest, MiyoFolderEntry } from "@/miyo/MiyoClient";
import { miyoRecordCoversScope, resyncMiyoFolder, verifyMiyoScope } from "@/miyo/miyoResync";

const app = { vault: { getName: () => "my-vault" } } as unknown as App;

/** Stored sync receipt; defaults to this device/endpoint/folder identity. */
function receiptFor(
  over: Partial<{ device: string; url: string; folder: string; roots: string[] }> = {}
): string {
  return JSON.stringify({
    device: "device-A",
    url: "",
    folder: "my-vault",
    roots: ["copilot"],
    ...over,
  });
}

/** Folder record as Miyo returns it; loose shape like the real entry type. */
function record(over: Record<string, unknown> = {}): MiyoFolderEntry {
  return {
    path: "my-vault",
    exclude_folders: ["copilot"],
    exclude_patterns: [],
    include_folders: [],
    include_patterns: [],
    include_extensions: [],
    allow_remote_read: true,
    allow_writes: true,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  currentSettings = {
    copilotFolder: "copilot",
    copilotRootHistory: ["copilot"],
    miyoServerUrl: "",
    qaInclusions: "",
    qaExclusions: "copilot",
    miyoSyncedExclusions: "",
  };
  resolveBaseUrl.mockResolvedValue("http://miyo");
  deleteFolder.mockResolvedValue(undefined);
  addFolder.mockResolvedValue(record());
  scanFolder.mockResolvedValue({});
});

/** Settings for a vault whose root moved to team/ai (record above is stale). */
function rootMovedSettings(): void {
  currentSettings = {
    ...currentSettings,
    copilotFolder: "team/ai",
    copilotRootHistory: ["copilot", "team/ai"],
  };
}

describe("miyoResync", () => {
  describe("miyoRecordCoversScope()", () => {
    const desired: MiyoAddFolderRequest = {
      path: "/abs/vault",
      exclude_folders: ["copilot", "team/ai"],
    };

    it("accepts a record whose exclusions are a superset of the desired ones", () => {
      expect(
        miyoRecordCoversScope(
          record({ exclude_folders: ["copilot", "team/ai", "user-extra"] }),
          desired
        )
      ).toBe(true);
    });

    it("rejects a record missing a desired exclusion", () => {
      expect(miyoRecordCoversScope(record({ exclude_folders: ["copilot"] }), desired)).toBe(false);
    });

    it("rejects a record whose inclusions differ (a different scope, not a superset)", () => {
      expect(
        miyoRecordCoversScope(
          record({ exclude_folders: ["copilot", "team/ai"], include_folders: ["notes"] }),
          desired
        )
      ).toBe(false);
    });
  });

  describe("resyncMiyoFolder()", () => {
    it("verifies without rebuilding when the record already covers the scope", async () => {
      getFolder.mockResolvedValue(record());

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("verified");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("deletes and re-registers with the fresh scope when the record is stale", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record()); // still only excludes "copilot"

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("resynced");
      expect(deleteFolder).toHaveBeenCalledWith("my-vault", undefined);
      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.path).toBe("/abs/vault");
      expect(body.exclude_folders).toEqual(expect.arrayContaining(["copilot", "team/ai"]));
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
      expect(scanFolder).toHaveBeenCalled();
    });

    it("carries the record's Relay opt-out into the re-registration", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record({ allow_remote_read: false }));

      await resyncMiyoFolder(app);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.allow_remote_read).toBe(false);
    });

    it("fails closed on Relay when the record omits the field", async () => {
      // Omitting allow_remote_read makes the server default it to TRUE —
      // silently re-enabling Relay for a user who opted out in Miyo.
      rootMovedSettings();
      const stale = record({ allow_remote_read: undefined });
      delete (stale as Record<string, unknown>).allow_remote_read;
      getFolder.mockResolvedValue(stale);

      await resyncMiyoFolder(app);

      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.allow_remote_read).toBe(false);
    });

    it("recovers an unregistered vault by registering directly (no delete)", async () => {
      // A prior run deleted but never re-added, or the user removed the folder
      // in Miyo: GET 404 → POST straight away.
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("resynced");
      expect(deleteFolder).not.toHaveBeenCalled();
      const body = addFolder.mock.calls[0][0] as MiyoAddFolderRequest;
      expect(body.allow_remote_read).toBe(true); // register-flow default
    });

    it("reports a conflict and keeps the stale receipt when re-add hits 409", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record());
      addFolder.mockResolvedValue(null); // 409 → null per addFolder contract

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("conflict");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("fails without writing anything when the record can't be read", async () => {
      getFolder.mockRejectedValue(new Error("boom"));
      checkFolderRegistration.mockResolvedValue("error");

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("failed");
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("still writes the receipt when only the re-scan trigger fails", async () => {
      // The scope is committed; Miyo re-scans on its own. Staying dirty would
      // provoke another destructive delete/re-add for a self-healing lag.
      rootMovedSettings();
      getFolder.mockResolvedValue(record());
      scanFolder.mockRejectedValue(new Error("scan down"));

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("resynced-scan-failed");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("serializes concurrent runs instead of interleaving them", async () => {
      let releaseFirst!: (value: MiyoFolderEntry) => void;
      getFolder.mockImplementationOnce(
        () => new Promise<unknown>((resolve) => (releaseFirst = resolve))
      );
      getFolder.mockResolvedValue(record());

      const first = resyncMiyoFolder(app);
      const second = resyncMiyoFolder(app);
      // Flush pending microtasks so the first run reaches its blocked getFolder.
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      // The second run must not start (no second getFolder) while the first
      // still holds the mutation chain.
      expect(getFolder).toHaveBeenCalledTimes(1);

      releaseFirst(record());
      await expect(first).resolves.toBe("verified");
      await expect(second).resolves.toBe("verified");
      expect(getFolder).toHaveBeenCalledTimes(2);
    });

    it("cleans up the old registration when the vault was renamed on this device", async () => {
      // GET by the new name 404s, but the receipt shows THIS device+endpoint
      // registered under the old name — that stale registration is deleted
      // before registering the new name.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const outcome = await resyncMiyoFolder(app);

      expect(outcome).toBe("resynced");
      expect(deleteFolder).toHaveBeenCalledWith("old-vault-name", undefined);
    });

    it("never deletes based on a foreign device's receipt", async () => {
      currentSettings.miyoSyncedExclusions = receiptFor({
        device: "device-B",
        folder: "old-vault-name",
      });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      await resyncMiyoFolder(app);

      expect(deleteFolder).not.toHaveBeenCalled();
    });
  });

  describe("verifyMiyoScope()", () => {
    it("reports covered and self-heals the receipt when the record enforces the scope", async () => {
      getFolder.mockResolvedValue(record());
      currentSettings.miyoSyncedExclusions = receiptFor({ device: "device-B" }); // foreign, mismatch

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("covered");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", expect.any(String));
    });

    it("reports stale without touching the receipt when the record misses the scope", async () => {
      rootMovedSettings();
      getFolder.mockResolvedValue(record()); // only excludes "copilot"

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("stale");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("clears the receipt on 404 only when it names exactly this device/endpoint/folder", async () => {
      currentSettings.miyoSyncedExclusions = receiptFor();
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).toHaveBeenCalledWith("miyoSyncedExclusions", "");
    });

    it("keeps the receipt and reports stale on 404 after a same-device rename", async () => {
      // The old registration may still exist under the old name; the receipt is
      // the only cleanup lead and must survive.
      currentSettings.miyoSyncedExclusions = receiptFor({ folder: "old-vault-name" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("stale");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("never clears a non-empty receipt it cannot parse", async () => {
      // An unparseable value can't be attributed to any identity; wiping it
      // would sync out and destroy whatever evidence it holds elsewhere.
      currentSettings.miyoSyncedExclusions = "not-json";
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("leaves a foreign device's receipt untouched on 404", async () => {
      // Clearing it would clobber the other device's evidence via settings sync.
      currentSettings.miyoSyncedExclusions = receiptFor({ device: "device-B" });
      getFolder.mockRejectedValue(new Error("Miyo request failed with status 404"));
      checkFolderRegistration.mockResolvedValue("unregistered");

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("unregistered");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("reports unknown when the registration state can't be determined", async () => {
      getFolder.mockRejectedValue(new Error("boom"));
      checkFolderRegistration.mockResolvedValue("error");

      const verdict = await verifyMiyoScope(app);

      expect(verdict).toBe("unknown");
      expect(updateSetting).not.toHaveBeenCalled();
    });

    it("times out a hung lookup so the mutation chain keeps moving", async () => {
      jest.useFakeTimers();
      try {
        // A Miyo that accepts the connection but never responds must not hold
        // the chain forever: the lookup timeout fails this verify, and a
        // queued resync still gets its turn.
        getFolder.mockImplementationOnce(() => new Promise<never>(() => {}));
        checkFolderRegistration.mockResolvedValue("error");

        const verify = verifyMiyoScope(app);
        await jest.advanceTimersByTimeAsync(10_001);
        await expect(verify).resolves.toBe("unknown");

        getFolder.mockResolvedValue(record());
        await expect(verifyMiyoScope(app)).resolves.toBe("covered");
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
