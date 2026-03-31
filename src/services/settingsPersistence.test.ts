// Reason: structuredClone is not available in jsdom/Node <17 test environments
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}

import { DEFAULT_SETTINGS } from "@/constants";
import type { CustomModel } from "@/aiParams";
import type { CopilotSettings } from "@/settings/model";

/** Match the production secret-key heuristic without importing the real module. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password") ||
    lower.endsWith("licensekey")
  );
}

/** Build a full settings object while keeping tests compact. */
function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  } as CopilotSettings;
}

/** Build a minimal custom model for persistence tests. */
function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4",
    provider: "openai",
    enabled: true,
    ...overrides,
  } as CustomModel;
}

/** Load a fresh copy of the module with isolated mocks. */
async function loadModule(overrides?: {
  keychain?: Record<string, unknown>;
  isEncryptedValue?: (value: string) => boolean;
  getDecryptedKey?: (value: string) => Promise<string>;
}) {
  jest.resetModules();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("vault1234"),
    setVaultId: jest.fn(),
    backfillAndHydrate: jest.fn(async (settings: CopilotSettings) => ({
      settings,
      backfilledAny: false,
      hadFailures: false,
    })),
    persistSecrets: jest.fn().mockReturnValue({
      secretEntries: [],
      keychainIdsToDelete: [],
    }),
    setSecretById: jest.fn(),
    ...(overrides?.keychain ?? {}),
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
    isSecretKey: jest.fn((key: string) => isSensitiveKey(key)),
  }));

  jest.doMock("@/encryptionService", () => ({
    isSensitiveKey: jest.fn((key: string) => isSensitiveKey(key)),
    isEncryptedValue: jest.fn(overrides?.isEncryptedValue ?? (() => false)),
    getDecryptedKey: jest.fn(
      overrides?.getDecryptedKey ?? (async (v: string) => v.replace(/^enc_/, ""))
    ),
  }));

  jest.doMock("@/logger", () => ({ logWarn: jest.fn() }));

  // Reason: @/settings/model has deep import chains (@/constants → obsidian → etc.).
  // Mock it with real implementations of the functions settingsPersistence uses.
  // getSettings/setSettings are needed by clearDiskSecrets().
  const mockSettings = { current: makeSettings() };
  jest.doMock("@/settings/model", () => ({
    sanitizeSettings: jest.fn((s: CopilotSettings) => s),
    getModelKeyFromModel: jest.fn(
      (m: { name: string; provider: string }) => `${m.name}|${m.provider}`
    ),
    // Reason: EmbeddingModelProviders.AZURE_OPENAI = "azure openai" (with space)
    normalizeModelProvider: jest.fn((p: string) =>
      p === "azure_openai" ? "azure openai" : p
    ),
    getSettings: jest.fn(() => mockSettings.current),
    setSettings: jest.fn((s: Partial<CopilotSettings>) => {
      mockSettings.current = { ...mockSettings.current, ...s } as CopilotSettings;
    }),
  }));

  // Reason: settingsSecretTransforms imports isSensitiveKey from @/encryptionService.
  // Mock it directly to avoid transitive dependency issues with jest.doMock.
  jest.doMock("@/services/settingsSecretTransforms", () => ({
    MODEL_SECRET_FIELDS: ["apiKey"] as const,
    // Reason: mirror the real hasPersistedSecrets() logic so that tests with
    // disk secrets (auto-clear, migration timestamp) behave correctly, while
    // fresh-install tests (no secrets) get _diskSecretsCleared = true.
    hasPersistedSecrets: jest.fn((rawData: Record<string, unknown>) => {
      for (const key of Object.keys(rawData)) {
        if (!isSensitiveKey(key)) continue;
        const value = rawData[key];
        if (typeof value === "string" && value.length > 0) return true;
      }
      return false;
    }),
    stripKeychainFields: jest.fn((s: CopilotSettings) => {
      const out = { ...s } as unknown as Record<string, unknown>;
      for (const key of Object.keys(out)) {
        if (isSensitiveKey(key)) out[key] = "";
      }
      return out as unknown as CopilotSettings;
    }),
    cleanupLegacyFields: jest.fn((s: CopilotSettings) => ({ ...s })),
  }));

  const mod = await import("./settingsPersistence");
  return { mod, keychain, mockSettings };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// persistSettings — migration-window save behavior
// ---------------------------------------------------------------------------

describe("persistSettings migration-window", () => {
  it("writes current secret values to data.json during migration window", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    // Reason: snapshot has an old enc_* value, but current memory has plaintext.
    // After simplification, Branch B saves the current in-memory value directly.
    mod.refreshDiskHasSecrets(
      makeSettings({ openAIApiKey: "enc_disk_openai" })
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    const prev = makeSettings({ openAIApiKey: "sk-123" });
    const current = makeSettings({ openAIApiKey: "sk-123" });

    await mod.persistSettings(current, saveData, prev);
    await mod.flushPersistence();

    // Reason: Branch B now saves current values directly — no enc_* preservation
    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ openAIApiKey: "sk-123" })
    );
  });

  it("writes new plaintext when a top-level secret changed", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mod.refreshDiskHasSecrets(makeSettings({ openAIApiKey: "enc_disk_old" }));

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-new"]],
      keychainIdsToDelete: [],
    });

    const prev = makeSettings({ openAIApiKey: "sk-old" });
    const current = makeSettings({ openAIApiKey: "sk-new" });

    await mod.persistSettings(current, saveData, prev);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ openAIApiKey: "sk-new" })
    );
  });
});

// ---------------------------------------------------------------------------
// loadSettingsWithKeychain — high-risk load paths
// ---------------------------------------------------------------------------

describe("loadSettingsWithKeychain", () => {
  it("persists a first-run vault ID when raw data does not have one", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const raw = makeSettings({ _keychainVaultId: undefined } as unknown as Partial<CopilotSettings>);

    const loaded = await mod.loadSettingsWithKeychain(raw, saveData);

    expect(keychain.getVaultId).toHaveBeenCalled();
    expect(keychain.setVaultId).not.toHaveBeenCalled();
    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ _keychainVaultId: "vault1234" })
    );
    expect((loaded as unknown as Record<string, unknown>)._keychainVaultId).toBe("vault1234");
  });

  it("stamps _keychainMigratedAt after the first successful backfill", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-29T12:00:00.000Z"));

    const { mod } = await loadModule({
      keychain: {
        backfillAndHydrate: jest.fn(async (settings: CopilotSettings) => ({
          settings,
          backfilledAny: true,
          hadFailures: false,
        })),
      },
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    const raw = makeSettings({
      _keychainVaultId: "vault1234",
    } as unknown as Partial<CopilotSettings>);

    await mod.loadSettingsWithKeychain(raw, saveData);

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ _keychainMigratedAt: "2026-03-29T12:00:00.000Z" })
    );
  });

  it("auto-clears disk secrets after 7 days when backfill had no failures", async () => {
    const oldStamp = "2026-03-20T00:00:00.000Z";
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-29T00:00:00.000Z").getTime());

    const { mod } = await loadModule({
      keychain: {
        backfillAndHydrate: jest.fn(async () => ({
          settings: makeSettings({
            _keychainVaultId: "vault1234",
            _keychainMigratedAt: oldStamp,
            openAIApiKey: "sk-123",
          } as unknown as Partial<CopilotSettings>),
          backfilledAny: false,
          hadFailures: false,
        })),
      },
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    const raw = makeSettings({
      _keychainVaultId: "vault1234",
      _keychainMigratedAt: oldStamp,
      openAIApiKey: "enc_disk_openai",
    } as unknown as Partial<CopilotSettings>);

    const loaded = await mod.loadSettingsWithKeychain(raw, saveData);

    // Reason: 7+ days passed and no failures → auto-clear should strip secrets
    const autoSaveCall = saveData.mock.calls.find(
      (args: CopilotSettings[]) =>
        (args[0] as unknown as Record<string, unknown>)._diskSecretsCleared === true
    );
    expect(autoSaveCall).toBeDefined();
    // Reason: verify secrets were actually stripped, not just the flag set
    const autoSavePayload = autoSaveCall![0] as unknown as Record<string, unknown>;
    expect(autoSavePayload.openAIApiKey).toBe("");
    expect((loaded as unknown as Record<string, unknown>)._diskSecretsCleared).toBe(true);
  });

  it("does NOT auto-clear disk secrets when backfill reported failures", async () => {
    const oldStamp = "2026-03-20T00:00:00.000Z";
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-29T00:00:00.000Z").getTime());

    const { mod } = await loadModule({
      keychain: {
        backfillAndHydrate: jest.fn(async () => ({
          settings: makeSettings({
            _keychainVaultId: "vault1234",
            _keychainMigratedAt: oldStamp,
            openAIApiKey: "sk-123",
          } as unknown as Partial<CopilotSettings>),
          backfilledAny: false,
          hadFailures: true,
        })),
      },
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    const raw = makeSettings({
      _keychainVaultId: "vault1234",
      _keychainMigratedAt: oldStamp,
      openAIApiKey: "enc_disk_openai",
    } as unknown as Partial<CopilotSettings>);

    await mod.loadSettingsWithKeychain(raw, saveData);

    // Reason: hadFailures is true → auto-clear must be skipped
    const autoSaveCall = saveData.mock.calls.find(
      (args: CopilotSettings[]) =>
        (args[0] as unknown as Record<string, unknown>)._diskSecretsCleared === true
    );
    expect(autoSaveCall).toBeUndefined();
    expect(mod.getBackfillHadFailures()).toBe(true);
  });

  it("decrypts disk secrets when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });

    const loaded = await mod.loadSettingsWithKeychain(
      makeSettings({
        openAIApiKey: "enc_disk_openai",
        activeModels: [makeModel({ apiKey: "enc_model_key" })],
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    // Reason: encrypted disk values must be decrypted for runtime use
    // so ciphertext doesn't flow into LLM provider requests.
    expect(loaded.openAIApiKey).toBe("disk_openai");
    expect(loaded.activeModels[0].apiKey).toBe("model_key");
  });
});

// ---------------------------------------------------------------------------
// clearDiskSecrets
// ---------------------------------------------------------------------------

describe("clearDiskSecrets", () => {
  it("strips secrets from disk and sets _diskSecretsCleared in memory", async () => {
    const { mod, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-live",
      anthropicApiKey: "sk-ant",
    });

    const saveData = jest.fn().mockResolvedValue(undefined);

    // Seed cached disk-secret state with secrets via loadSettingsWithKeychain
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    await mod.clearDiskSecrets(saveData);

    expect(saveData).toHaveBeenCalledTimes(1);
    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._diskSecretsCleared).toBe(true);
    expect(saved.openAIApiKey).toBe("");
    expect((mockSettings.current as unknown as Record<string, unknown>)._diskSecretsCleared).toBe(
      true
    );
  });

  it("propagates saveData errors to the caller", async () => {
    const { mod, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });

    // Seed snapshot
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const saveData = jest.fn().mockRejectedValue(new Error("disk full"));
    await expect(mod.clearDiskSecrets(saveData)).rejects.toThrow("disk full");
  });
});

// ---------------------------------------------------------------------------
// canClearDiskSecrets
// ---------------------------------------------------------------------------

describe("canClearDiskSecrets", () => {
  it("returns true when keychain available, no failures, disk has secrets, not yet cleared", async () => {
    const { mod } = await loadModule();

    // Seed snapshot with secrets
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings({ openAIApiKey: "sk-live" });
    expect(mod.canClearDiskSecrets(settings)).toBe(true);
  });

  it("returns false when _diskSecretsCleared is true", async () => {
    const { mod } = await loadModule();

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings({
      _diskSecretsCleared: true,
    } as unknown as Partial<CopilotSettings>);
    expect(mod.canClearDiskSecrets(settings)).toBe(false);
  });

  it("returns false when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });

    const settings = makeSettings({ openAIApiKey: "sk-live" });
    expect(mod.canClearDiskSecrets(settings)).toBe(false);
  });

  it("returns false when backfill had failures", async () => {
    const { mod } = await loadModule({
      keychain: {
        backfillAndHydrate: jest.fn(async (s: CopilotSettings) => ({
          settings: s,
          backfilledAny: true,
          hadFailures: true,
        })),
      },
    });

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings({ openAIApiKey: "sk-live" });
    expect(mod.canClearDiskSecrets(settings)).toBe(false);
  });

  it("returns false when disk has no secrets", async () => {
    const { mod } = await loadModule();

    // Fresh install — no secrets in snapshot
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings();
    expect(mod.canClearDiskSecrets(settings)).toBe(false);
  });
});
