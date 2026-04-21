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
  hasEncryptionPrefix?: (value: string) => boolean;
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
    deleteSecretById: jest.fn(),
    ...(overrides?.keychain ?? {}),
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
    isSecretKey: jest.fn((key: string) => isSensitiveKey(key)),
  }));

  jest.doMock("@/encryptionService", () => ({
    isSensitiveKey: jest.fn((key: string) => isSensitiveKey(key)),
    // Reason: persistence code uses the permissive prefix-only detector so a
    // corrupted enc_* payload is still treated as encrypted-and-failed.
    hasEncryptionPrefix: jest.fn(
      overrides?.hasEncryptionPrefix ?? ((v: string) => v.startsWith("enc_"))
    ),
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
    normalizeModelProvider: jest.fn((p: string) => (p === "azure_openai" ? "azure openai" : p)),
    getSettings: jest.fn(() => mockSettings.current),
    setSettings: jest.fn((s: Partial<CopilotSettings>) => {
      mockSettings.current = { ...mockSettings.current, ...s } as CopilotSettings;
    }),
  }));

  // Reason: settingsSecretTransforms imports isSensitiveKey from @/encryptionService.
  // Mock it directly to avoid transitive dependency issues with jest.doMock.
  jest.doMock("@/services/settingsSecretTransforms", () => ({
    MODEL_SECRET_FIELDS: ["apiKey"] as const,
    // Reason: mirror the real hasPersistedSecrets() logic, including
    // model-level apiKey scanning, so risky paths like "secret only on
    // activeModels[*]" do not get a false-positive pass.
    hasPersistedSecrets: jest.fn((rawData: Record<string, unknown>) => {
      for (const key of Object.keys(rawData)) {
        if (!isSensitiveKey(key)) continue;
        const value = rawData[key];
        if (typeof value === "string" && value.length > 0) return true;
      }
      for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
        const models = rawData[listKey];
        if (!Array.isArray(models)) continue;
        for (const model of models) {
          if (!model || typeof model !== "object") continue;
          const value = (model as Record<string, unknown>).apiKey;
          if (typeof value === "string" && value.length > 0) return true;
        }
      }
      return false;
    }),
    stripKeychainFields: jest.fn((s: CopilotSettings) => {
      const out = { ...s } as unknown as Record<string, unknown>;
      for (const key of Object.keys(out)) {
        if (isSensitiveKey(key)) out[key] = "";
      }
      // Reason: mirror production, which also blanks model-level apiKey on each
      // entry of activeModels / activeEmbeddingModels.
      for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
        const models = (s as unknown as Record<string, unknown>)[listKey];
        if (!Array.isArray(models)) continue;
        out[listKey] = models.map((m) => ({
          ...(m as Record<string, unknown>),
          apiKey: "",
        }));
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
// persistSettings — keychain-aware save behavior
// ---------------------------------------------------------------------------

describe("persistSettings keychain-aware", () => {
  it("strips secrets from data.json when _diskSecretsCleared is true", async () => {
    const { mod, keychain, mockSettings } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mod.refreshDiskHasSecrets(makeSettings({ openAIApiKey: "enc_disk_openai" }));
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-123",
      _diskSecretsCleared: true,
    } as unknown as Partial<CopilotSettings>);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    const current = mockSettings.current;
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ openAIApiKey: "" }));
    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._diskSecretsCleared).toBe(true);
  });

  it("keeps secrets in data.json during migration window (_diskSecretsCleared=false)", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mod.refreshDiskHasSecrets(makeSettings({ openAIApiKey: "enc_disk_openai" }));

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    // Reason: _diskSecretsCleared is NOT set → migration window → keep in data.json
    const current = makeSettings({ openAIApiKey: "sk-123" });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ openAIApiKey: "sk-123" }));
  });

  it("stamps _keychainMigratedAt on the first successful save when disk still has secrets and cleared", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-15T12:00:00.000Z"));

    const { mod, keychain, mockSettings } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mod.refreshDiskHasSecrets(makeSettings({ openAIApiKey: "enc_disk_openai" }));
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-123",
      _diskSecretsCleared: true,
    } as unknown as Partial<CopilotSettings>);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    const current = mockSettings.current;
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ _keychainMigratedAt: "2026-04-15T12:00:00.000Z" })
    );
  });

  it("preserves disk fallback when an undecryptable legacy secret is encountered", async () => {
    const { mod, keychain } = await loadModule({
      hasEncryptionPrefix: (v) => v.startsWith("enc_"),
      // Reason: simulate a corrupt legacy enc_* whose decryption returns "".
      getDecryptedKey: async (v) => (v.startsWith("enc_bad") ? "" : v.replace(/^enc_/, "")),
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "enc_bad_legacy"]],
      keychainIdsToDelete: [],
    });

    const current = makeSettings({ openAIApiKey: "enc_bad_legacy" });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    // Reason (Critical-1 corner): when keychain rejected the only copy of a
    // legacy secret, do NOT strip — the on-disk enc_* would be lost otherwise.
    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.openAIApiKey).toBe("enc_bad_legacy");
    expect(saved._diskSecretsCleared).toBe(false);
  });

  it("does not leak plaintext for successful fields in the skip-undecryptable branch", async () => {
    // Reason (R2-Critical-2): when one secret fails to decrypt AND the user
    // has already confirmed disk clearing, only that field's enc_* should be
    // preserved on disk; other plaintext secrets already in keychain must
    // still be stripped.
    const { mod, keychain } = await loadModule({
      hasEncryptionPrefix: (v) => v.startsWith("enc_"),
      getDecryptedKey: async (v) => (v.startsWith("enc_bad") ? "" : v.replace(/^enc_/, "")),
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [
        ["kc-openai", "enc_bad_legacy"], // fails decrypt → preserved
        ["kc-anthropic", "sk-anthropic-plaintext"], // succeeds → stripped
      ],
      keychainIdsToDelete: [],
    });

    const current = makeSettings({
      openAIApiKey: "enc_bad_legacy",
      anthropicApiKey: "sk-anthropic-plaintext",
      _diskSecretsCleared: true,
    } as unknown as Partial<CopilotSettings>);
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.openAIApiKey).toBe("enc_bad_legacy");
    expect(saved.anthropicApiKey).toBe("");
  });

  it("keeps all secrets on disk during migration window even when one is undecryptable", async () => {
    // Reason: during migration window (_diskSecretsCleared not set), ALL disk
    // secrets must be preserved for multi-device sync, even if one fails decrypt.
    const { mod, keychain } = await loadModule({
      hasEncryptionPrefix: (v) => v.startsWith("enc_"),
      getDecryptedKey: async (v) => (v.startsWith("enc_bad") ? "" : v.replace(/^enc_/, "")),
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [
        ["kc-openai", "enc_bad_legacy"],
        ["kc-anthropic", "sk-anthropic-plaintext"],
      ],
      keychainIdsToDelete: [],
    });

    const current = makeSettings({
      openAIApiKey: "enc_bad_legacy",
      anthropicApiKey: "sk-anthropic-plaintext",
    });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.openAIApiKey).toBe("enc_bad_legacy");
    // Migration window: other secrets preserved on disk
    expect(saved.anthropicApiKey).toBe("sk-anthropic-plaintext");
    expect(saved._diskSecretsCleared).toBe(false);
  });

  it("preserves prefixed-but-corrupted payloads via the permissive detector (top-level + model)", async () => {
    // Reason (R3-Major): the strict isEncryptedValue() rejects payloads that
    // do not pass the base64 sanity check. Persistence intentionally uses the
    // permissive hasEncryptionPrefix() so corrupted legacy values still take
    // the "skip + preserve on disk" path instead of leaking into keychain.
    const { mod, keychain } = await loadModule({
      // Reason: only rescue values whose payload is well-formed; this matches
      // the strict isEncryptedValue() semantics in production.
      hasEncryptionPrefix: (v) => v.startsWith("enc_"),
      getDecryptedKey: async (v) => {
        if (!v.startsWith("enc_")) return v;
        const payload = v.slice(4);
        return /^[A-Za-z0-9+/=]+$/.test(payload) ? payload : "";
      },
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [
        ["kc-openai", "enc_web_!!!corrupted"],
        ["kc-model", "enc_desk_???also_corrupted"],
      ],
      keychainIdsToDelete: [],
    });

    const current = makeSettings({
      openAIApiKey: "enc_web_!!!corrupted",
      activeModels: [makeModel({ apiKey: "enc_desk_???also_corrupted" })],
    });

    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.openAIApiKey).toBe("enc_web_!!!corrupted");
    const savedModels = saved.activeModels as Array<Record<string, unknown>>;
    expect(savedModels[0].apiKey).toBe("enc_desk_???also_corrupted");
    expect(saved._diskSecretsCleared).toBe(false);
    // Reason: keychain must not receive the corrupted ciphertext as if it were
    // plaintext — that would silently overwrite the slot with junk.
    expect(keychain.setSecretById).not.toHaveBeenCalledWith(
      "kc-openai",
      expect.stringContaining("enc_web_")
    );
    expect(keychain.setSecretById).not.toHaveBeenCalledWith(
      "kc-model",
      expect.stringContaining("enc_desk_")
    );
  });

  it("does not advance memory flags when saveData fails", async () => {
    const { mod, mockSettings, keychain } = await loadModule();
    mod.refreshDiskHasSecrets(makeSettings({ openAIApiKey: "enc_disk_openai" }));
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-123",
      _diskSecretsCleared: true,
    } as unknown as Partial<CopilotSettings>);

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockRejectedValue(new Error("disk full"));
    const current = mockSettings.current;

    await expect(
      mod.persistSettings(current, saveData, current).then(() => mod.flushPersistence())
    ).rejects.toThrow("disk full");

    const memory = mockSettings.current as unknown as Record<string, unknown>;
    expect(memory._keychainMigratedAt).toBeUndefined();
  });

  it("falls back to plaintext data.json only when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    const current = makeSettings({ openAIApiKey: "sk-fallback" });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ openAIApiKey: "sk-fallback" }));
  });
});

// ---------------------------------------------------------------------------
// loadSettingsWithKeychain — high-risk load paths
// ---------------------------------------------------------------------------

describe("loadSettingsWithKeychain", () => {
  it("persists a first-run vault ID when raw data does not have one", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const raw = makeSettings({
      _keychainVaultId: undefined,
    } as unknown as Partial<CopilotSettings>);

    const loaded = await mod.loadSettingsWithKeychain(raw, saveData);

    expect(keychain.getVaultId).toHaveBeenCalled();
    expect(keychain.setVaultId).not.toHaveBeenCalled();
    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ _keychainVaultId: "vault1234" })
    );
    expect((loaded as unknown as Record<string, unknown>)._keychainVaultId).toBe("vault1234");
  });

  it("treats bootstrap-only disk data (only _keychainVaultId) as a fresh install", async () => {
    // Reason: on first launch we persist _keychainVaultId before any real
    // settings are saved. If the user quits before adding API keys, the next
    // launch sees data.json with only that bootstrap field — it must still
    // count as fresh so subsequent key entries go to keychain-only mode and
    // never leak into data.json plaintext.
    const { mod } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const loaded = await mod.loadSettingsWithKeychain(
      { _keychainVaultId: "vault1234" } as unknown as CopilotSettings,
      saveData
    );

    expect((loaded as unknown as Record<string, unknown>)._diskSecretsCleared).toBe(true);
  });

  it("stamps _keychainMigratedAt on load when keychain is healthy and disk still has secrets", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-29T12:00:00.000Z"));

    // Reason (Major-2): the gate is now "no failures + disk has secrets",
    // not "backfilledAny". This covers the recovery path where keychain is
    // already populated from a previous session but disk still carries the
    // legacy copy.
    const { mod } = await loadModule({
      keychain: {
        backfillAndHydrate: jest.fn(async (settings: CopilotSettings) => ({
          settings,
          backfilledAny: false,
          hadFailures: false,
        })),
      },
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    const raw = makeSettings({
      _keychainVaultId: "vault1234",
      openAIApiKey: "enc_disk_openai",
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

  it("refuses to clear when the service-layer guard rejects the current settings", async () => {
    // Reason (Major-1): even if a UI caller forgets to gate on
    // canClearDiskSecrets(), clearDiskSecrets() must refuse to wipe the disk
    // when keychain is unavailable / disk already cleared / no secrets left.
    const { mod, mockSettings } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });

    const saveData = jest.fn().mockResolvedValue(undefined);

    await expect(mod.clearDiskSecrets(saveData)).rejects.toThrow(/Cannot clear disk secrets/);
    expect(saveData).not.toHaveBeenCalled();
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
// shouldShowMigrationModal
// ---------------------------------------------------------------------------

describe("shouldShowMigrationModal", () => {
  it("returns true when keychain is available, disk has secrets, and no suppression flag is set", async () => {
    const { mod } = await loadModule();

    // Seed snapshot so diskHasSecrets becomes true.
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings({ openAIApiKey: "sk-live" });
    expect(mod.shouldShowMigrationModal(settings)).toBe(true);
  });

  it("returns false when _migrationModalDismissed is true (Keep for now → dismiss persists)", async () => {
    const { mod } = await loadModule();

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings({
      openAIApiKey: "sk-live",
      _migrationModalDismissed: true,
    } as unknown as Partial<CopilotSettings>);
    expect(mod.shouldShowMigrationModal(settings)).toBe(false);
  });

  it("returns false when _diskSecretsCleared is true (cleared users never re-see the modal)", async () => {
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
    expect(mod.shouldShowMigrationModal(settings)).toBe(false);
  });

  it("returns false when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });

    const settings = makeSettings({ openAIApiKey: "sk-live" });
    expect(mod.shouldShowMigrationModal(settings)).toBe(false);
  });

  it("returns false on a fresh install (no disk secrets)", async () => {
    const { mod } = await loadModule();

    // Fresh snapshot — no sensitive values.
    await mod.loadSettingsWithKeychain(
      makeSettings({ _keychainVaultId: "vault1234" } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const settings = makeSettings();
    expect(mod.shouldShowMigrationModal(settings)).toBe(false);
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

// ---------------------------------------------------------------------------
// Stale-persist guard
// ---------------------------------------------------------------------------

describe("stale persist guard", () => {
  it("skips persist queued during a transaction", async () => {
    const { mod } = await loadModule();

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
        _diskSecretsCleared: true,
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const saveData = jest.fn().mockResolvedValue(undefined);

    // Simulate: a transaction is running and during its async work,
    // a settings change triggers a persist with a stale snapshot.
    await mod.runPersistenceTransaction(async () => {
      // Queue a persist DURING the transaction — this simulates a subscriber
      // firing while forgetAllSecrets is awaiting saveData.
      const staleSettings = makeSettings({ openAIApiKey: "sk-live" });
      mod.persistSettings(staleSettings, saveData, staleSettings);
    });

    await mod.flushPersistence();

    // Reason: the persist queued during the transaction should have been dropped
    expect(saveData).not.toHaveBeenCalled();
  });

  it("skips persist queued during a FAILED transaction", async () => {
    const { mod } = await loadModule();

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
        _diskSecretsCleared: true,
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const saveData = jest.fn().mockResolvedValue(undefined);

    // Simulate: transaction queues a persist, then throws (e.g. partial
    // keychain failure in clearAllVaultSecrets after disk was already stripped).
    await mod
      .runPersistenceTransaction(async () => {
        const staleSettings = makeSettings({ openAIApiKey: "sk-live" });
        mod.persistSettings(staleSettings, saveData, staleSettings);
        throw new Error("simulated clearAllVaultSecrets failure");
      })
      .catch(() => {
        /* expected */
      });

    await mod.flushPersistence();

    expect(saveData).not.toHaveBeenCalled();
  });
});
