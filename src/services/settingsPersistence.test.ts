import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import type { CopilotSettings } from "@/settings/model";
import type { StartupMigrationItem } from "@/services/startupMigration";

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    activeModels: [],
    activeEmbeddingModels: [],
    openAIApiKey: "",
    ...overrides,
  } as unknown as CopilotSettings;
}

const backedUp = jest.fn().mockResolvedValue({ status: "not-needed" });
const DEVICE_ID = "device-a";
// The device id lookup is mocked, so the app is never dereferenced.
const APP = {} as import("obsidian").App;

async function loadModule(overrides: Record<string, unknown> = {}) {
  jest.resetModules();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("abcd1234"),
    setVaultId: jest.fn(),
    hydrateFromKeychain: jest.fn(async (settings: CopilotSettings) => ({
      settings,
      hadFailures: false,
    })),
    persistSecrets: jest.fn().mockReturnValue({
      secretEntries: [],
      keychainIdsToDelete: [],
    }),
    setSecretById: jest.fn(),
    ...overrides,
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
  }));
  jest.doMock("@/logger", () => ({ logWarn: jest.fn() }));
  jest.doMock("@/settings/model", () => ({
    sanitizeSettings: jest.fn((settings: CopilotSettings) => settings),
  }));
  jest.doMock("@/utils/deviceId", () => ({ getDeviceId: jest.fn(() => DEVICE_ID) }));

  const module = await import("@/services/settingsPersistence");
  return { module, keychain };
}

describe("settingsPersistence", () => {
  describe("resetPersistenceState()", () => {
    it("clears a pending one-shot persist suppression", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      module.resetPersistenceState();
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshLastPersistedSettings()", () => {
    it("sets the Keychain diff baseline for the next write", async () => {
      const { module, keychain } = await loadModule();
      const baseline = makeSettings({ openAIApiKey: "old-key" });
      const next = makeSettings({ openAIApiKey: "new-key" });
      module.refreshLastPersistedSettings(baseline);

      await module.persistSettings(next, jest.fn().mockResolvedValue(undefined));

      expect(keychain.persistSecrets).toHaveBeenCalledWith(next, baseline);
    });
  });

  describe("suppressNextPersistOnce()", () => {
    it("skips exactly one subscriber-driven save", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      await module.persistSettings(makeSettings(), saveData);
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("runPersistenceTransaction()", () => {
    it("keeps the queue usable after a transaction fails", async () => {
      const { module } = await loadModule();
      const failure = new Error("failed transaction");

      await expect(
        module.runPersistenceTransaction(async () => {
          throw failure;
        })
      ).rejects.toBe(failure);

      const followup = jest.fn().mockResolvedValue(undefined);
      await module.runPersistenceTransaction(followup);
      expect(followup).toHaveBeenCalledTimes(1);
    });
  });

  describe("flushPersistence()", () => {
    it("waits for the active settings write", async () => {
      const { module } = await loadModule();
      let release!: () => void;
      const saveData = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      const persist = module.persistSettings(makeSettings(), saveData);
      await Promise.resolve();

      let flushed = false;
      const flush = module.flushPersistence().then(() => {
        flushed = true;
      });
      await Promise.resolve();
      expect(flushed).toBe(false);

      release();
      await Promise.all([persist, flush]);
      expect(flushed).toBe(true);
    });
  });

  describe("loadSettingsWithKeychain()", () => {
    it("discards disk credentials and exposes only Keychain-hydrated values", async () => {
      const { module, keychain } = await loadModule();
      keychain.hydrateFromKeychain.mockImplementation(async (settings: CopilotSettings) => ({
        settings: { ...settings, openAIApiKey: "keychain-key" },
        hadFailures: false,
      }));
      const saveData = jest.fn().mockResolvedValue(undefined);

      const loaded = await module.loadSettingsWithKeychain(
        APP,
        {
          _keychainVaultId: "1234abcd",
          _keychainOnly: false,
          openAIApiKey: "enc_desk_legacy",
          activeModels: [{ name: "custom", provider: "openai", apiKey: "plaintext-disk-key" }],
          activeEmbeddingModels: [],
        },
        saveData,
        backedUp
      );

      const hydrateInput = keychain.hydrateFromKeychain.mock.calls[0][0];
      expect(hydrateInput.openAIApiKey).toBe("");
      expect(hydrateInput.activeModels[0].apiKey).toBe("");
      expect(loaded.openAIApiKey).toBe("keychain-key");
      expect(saveData).toHaveBeenCalledWith(
        expect.objectContaining({
          _keychainVaultId: "1234abcd",
          openAIApiKey: "",
          activeModels: [expect.objectContaining({ apiKey: "" })],
        })
      );
      expect(saveData.mock.calls[0][0]).not.toHaveProperty("_keychainOnly");
    });

    it("keeps credentials empty when Keychain is unavailable", async () => {
      const { module, keychain } = await loadModule();
      keychain.isAvailable.mockReturnValue(false);

      const loaded = await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined),
        backedUp
      );

      expect(loaded.openAIApiKey).toBe("");
      expect(keychain.hydrateFromKeychain).not.toHaveBeenCalled();
    });

    it("persists a vault namespace and current schema version for a fresh install", async () => {
      const { module, keychain } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(APP, null, saveData, backedUp);

      expect(keychain.setVaultId).toHaveBeenCalledWith("abcd1234");
      expect(saveData).toHaveBeenCalledWith({
        _keychainVaultId: "abcd1234",
        settingsVersion: CURRENT_SETTINGS_VERSION,
      });
    });
    it("leaves data.json intact when the credential backup fails", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        saveData,
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );

      expect(saveData).not.toHaveBeenCalled();
    });

    it("strips data.json once the credentials are backed up", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        saveData,
        jest.fn().mockResolvedValue({
          status: "backed-up",
          path: "plugins/copilot/backup.json",
          encrypted: false,
        })
      );

      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
    });

    it("reports a backed-up credential migration instead of opening a separate notice", async () => {
      const { module } = await loadModule();
      const onMigration = jest.fn();
      const saveData = jest.fn().mockResolvedValue(undefined);

      const result = await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        saveData,
        jest.fn().mockResolvedValue({
          status: "backed-up",
          path: "config/plugins/copilot/backup.json",
          encrypted: false,
        }),
        onMigration
      );

      expect(onMigration).toHaveBeenCalledWith(
        expect.objectContaining({ id: "credentials", status: "action-required" })
      );
      expect(saveData).toHaveBeenCalledWith(
        expect.objectContaining({
          _pendingCredentialRecovery: {
            deviceId: DEVICE_ID,
            path: "config/plugins/copilot/backup.json",
            encrypted: false,
          },
        })
      );
      expect(result._pendingCredentialRecovery).toEqual({
        deviceId: DEVICE_ID,
        path: "config/plugins/copilot/backup.json",
        encrypted: false,
      });
    });

    it("replays pending credential recovery after data.json was stripped", async () => {
      const { module } = await loadModule();
      const onMigration = jest.fn();

      await module.loadSettingsWithKeychain(
        APP,
        {
          _keychainVaultId: "1234abcd",
          _pendingCredentialRecovery: {
            deviceId: DEVICE_ID,
            path: "config/plugins/copilot/backup.json",
            encrypted: false,
          },
        },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "not-needed" }),
        onMigration
      );

      const result = onMigration.mock.calls[0][0] as StartupMigrationItem;
      expect(result.id).toBe("credentials");
      expect(result.details?.some((detail) => detail.includes("backup.json"))).toBe(true);
    });

    it("preserves another device's credential recovery without reporting it locally", async () => {
      const { module } = await loadModule();
      const onMigration = jest.fn();
      const recovery = {
        deviceId: "device-b",
        path: "config/plugins/copilot/device-b-backup.json",
        encrypted: false,
      };

      const result = await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", _pendingCredentialRecovery: recovery },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "not-needed" }),
        onMigration
      );

      expect(onMigration).not.toHaveBeenCalled();
      expect(result._pendingCredentialRecovery).toEqual(recovery);
    });

    it("includes Keychain availability failures in the credential migration result", async () => {
      const { module, keychain } = await loadModule();
      keychain.isAvailable.mockReturnValue(false);
      const onMigration = jest.fn();

      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({
          status: "backed-up",
          path: "config/plugins/copilot/backup.json",
          encrypted: false,
        }),
        onMigration
      );

      const result = onMigration.mock.calls[0][0] as StartupMigrationItem;
      expect(result.status).toBe("error");
      expect(result.details?.some((detail) => detail.includes("Keychain is unavailable"))).toBe(
        true
      );
    });

    it("rejects later settings writes rather than skipping them when the backup fails", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [["copilot-vabcd1234-open-a-i-api-key", "re-entered"]],
          keychainIdsToDelete: [],
        }),
      });
      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );
      const saveData = jest.fn().mockResolvedValue(undefined);

      // Reason: migrations and the settings subscriber both persist moments
      // after load. Resolving quietly would report an unwritten file as saved,
      // which `applyCopilotRootChange()` treats as durable.
      await expect(module.persistSettings(makeSettings(), saveData)).rejects.toThrow(
        "cannot save settings"
      );
      expect(saveData).not.toHaveBeenCalled();
      expect(keychain.setSecretById).not.toHaveBeenCalled();
    });

    it("rejects a durable transaction while the hold is active", async () => {
      const { module } = await loadModule();
      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );

      await expect(
        module.persistSettingsWithinTransaction(
          makeSettings(),
          jest.fn().mockResolvedValue(undefined)
        )
      ).rejects.toThrow("cannot save settings");
    });
  });

  describe("releaseLegacyCredentialHold()", () => {
    it("resumes writing once a dedicated flow has stripped data.json", async () => {
      const { module } = await loadModule();
      await module.loadSettingsWithKeychain(
        APP,
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );
      const saveData = jest.fn().mockResolvedValue(undefined);

      module.releaseLegacyCredentialHold();
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistSettingsWithinTransaction()", () => {
    it("writes Keychain entries and strips the disk snapshot immediately", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [["copilot-vabcd1234-open-a-i-api-key", "new-key"]],
          keychainIdsToDelete: [],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettingsWithinTransaction(
        makeSettings({ openAIApiKey: "new-key" }),
        saveData
      );

      expect(keychain.setSecretById).toHaveBeenCalledWith(
        "copilot-vabcd1234-open-a-i-api-key",
        "new-key"
      );
      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
    });
  });

  describe("persistSettings()", () => {
    it("tombstones cleared credentials and never writes them to data.json", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [],
          keychainIdsToDelete: ["copilot-vabcd1234-open-a-i-api-key"],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettings(makeSettings(), saveData);

      expect(keychain.setSecretById).toHaveBeenCalledWith("copilot-vabcd1234-open-a-i-api-key", "");
      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
    });

    it("rolls Keychain values back when the disk save fails", async () => {
      const persistSecrets = jest
        .fn()
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "new-key"]],
          keychainIdsToDelete: [],
        })
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "old-key"]],
          keychainIdsToDelete: [],
        });
      const { module, keychain } = await loadModule({ persistSecrets });
      module.refreshLastPersistedSettings(makeSettings({ openAIApiKey: "old-key" }));

      await expect(
        module.persistSettings(
          makeSettings({ openAIApiKey: "new-key" }),
          jest.fn().mockRejectedValue(new Error("disk full"))
        )
      ).rejects.toThrow("disk full");

      expect(keychain.setSecretById).toHaveBeenNthCalledWith(1, "credential-id", "new-key");
      expect(keychain.setSecretById).toHaveBeenNthCalledWith(2, "credential-id", "old-key");
    });
  });
});
