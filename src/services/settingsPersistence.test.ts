// Reason: structuredClone is missing in some jsdom builds shipped with our
// Jest version. Polyfilled here (not in jest.setup.js) so the lossy
// JSON-fallback only affects this file — other suites get jsdom's real
// implementation when available.
if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
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
  };
}

/** Build a minimal custom model for persistence tests. */
function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4",
    provider: "openai",
    enabled: true,
    ...overrides,
  };
}

/** Load a fresh copy of the module with isolated mocks. */
async function loadModule(overrides?: {
  keychain?: Record<string, unknown>;
  getDecryptedKey?: (value: string) => Promise<string>;
}) {
  jest.resetModules();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("vault1234"),
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
    deleteSecretById: jest.fn(),
    getSecret: jest.fn().mockReturnValue(null),
    getModelSecret: jest.fn().mockReturnValue(null),
    ...(overrides?.keychain ?? {}),
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
    isSecretKey: jest.fn((key: string) => isSensitiveKey(key)),
  }));

  jest.doMock("@/encryptionService", () => ({
    isSensitiveKey: jest.fn((key: string) => isSensitiveKey(key)),
    getDecryptedKey: jest.fn(
      overrides?.getDecryptedKey ?? (async (v: string) => v.replace(/^enc_/, ""))
    ),
    hasEncryptionPrefix: jest.fn((value: string) => value.startsWith("enc_")),
  }));

  jest.doMock("@/logger", () => ({ logWarn: jest.fn() }));

  const mockSettings = { current: makeSettings() };
  jest.doMock("@/settings/model", () => ({
    sanitizeSettings: jest.fn((s: CopilotSettings) => s),
    getModelKeyFromModel: jest.fn(
      (m: { name: string; provider: string }) => `${m.name}|${m.provider}`
    ),
    normalizeModelProvider: jest.fn((p: string) => (p === "azure_openai" ? "azure openai" : p)),
    getSettings: jest.fn(() => mockSettings.current),
    setSettings: jest.fn((s: Partial<CopilotSettings>) => {
      mockSettings.current = { ...mockSettings.current, ...s };
    }),
  }));

  jest.doMock("@/services/settingsSecretTransforms", () => ({
    MODEL_SECRET_FIELDS: ["apiKey"] as const,
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
    cleanupLegacyFields: jest.fn((s: CopilotSettings) => {
      const out = { ...s } as unknown as Record<string, unknown>;
      delete out.enableEncryption;
      delete out._keychainMigrated;
      delete out._keychainMigratedAt;
      delete out._migrationModalDismissed;
      if (out._diskSecretsCleared !== undefined && out._keychainOnly === undefined) {
        out._keychainOnly = out._diskSecretsCleared;
      }
      delete out._diskSecretsCleared;
      return out as unknown as CopilotSettings;
    }),
    isKeychainOnly: jest.fn(
      (s: CopilotSettings) => (s as unknown as Record<string, unknown>)._keychainOnly === true
    ),
  }));

  const mod = await import("./settingsPersistence");
  return { mod, keychain, mockSettings };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// loadSettingsWithKeychain — mode dispatch and fresh-install promotion
// ---------------------------------------------------------------------------

describe("loadSettingsWithKeychain", () => {
  it("promotes to keychain-only on a truly fresh install (rawData == null)", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const loaded = await mod.loadSettingsWithKeychain(null, saveData);

    expect((loaded as unknown as Record<string, unknown>)._keychainOnly).toBe(true);
    // Reason: even on fresh install, hydrateFromKeychain still runs so
    // tombstones / pre-existing keychain entries are honored.
    expect(keychain.hydrateFromKeychain).toHaveBeenCalled();
  });

  it("does NOT promote to keychain-only when rawData is an empty object", async () => {
    // Reason: existing user who manually cleared their keys (`data.json` exists
    // but is empty) must stay in disk mode — promoting them would silently flip
    // future key entries into keychain-only and violate opt-in.
    const { mod } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const loaded = await mod.loadSettingsWithKeychain({}, saveData);

    expect((loaded as unknown as Record<string, unknown>)._keychainOnly).toBeUndefined();
  });

  it("disk mode load never touches the keychain", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "enc_disk_openai",
      }),
      saveData
    );

    expect(keychain.hydrateFromKeychain).not.toHaveBeenCalled();
    expect(keychain.getSecret).not.toHaveBeenCalled();
    expect(keychain.setSecretById).not.toHaveBeenCalled();
  });

  it("disk mode decrypts legacy enc_* values for runtime use", async () => {
    const { mod } = await loadModule();

    const loaded = await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "enc_disk_openai",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    expect(loaded.openAIApiKey).toBe("disk_openai");
  });

  it("keychain-only mode reads from keychain and ignores any stale disk secret", async () => {
    const { mod, keychain } = await loadModule({
      keychain: {
        hydrateFromKeychain: jest.fn(async (s: CopilotSettings) => ({
          settings: { ...s, openAIApiKey: "kc-value" },
          hadFailures: false,
        })),
      },
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const loaded = await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        _keychainOnly: true,
        // Reason: stale disk leftover from cross-version sync.
        openAIApiKey: "should-be-ignored",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    expect(keychain.hydrateFromKeychain).toHaveBeenCalled();
    expect(loaded.openAIApiKey).toBe("kc-value");
    // Reason: scenario H — log a warning when stale disk secrets are observed
    // alongside keychain-only mode.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("disk secrets ignored because keychain-only")
    );

    warnSpy.mockRestore();
  });

  it("decrypts disk values when keychain is unavailable", async () => {
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

    expect(loaded.openAIApiKey).toBe("disk_openai");
    expect(loaded.activeModels[0].apiKey).toBe("model_key");
  });

  it("persists a first-run vault ID when raw data does not have one", async () => {
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const raw = makeSettings({
      _keychainVaultId: undefined,
    });

    await mod.loadSettingsWithKeychain(raw, saveData);

    expect(keychain.getVaultId).toHaveBeenCalled();
    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ _keychainVaultId: "vault1234" })
    );
  });

  it("stranded keychain-only vault never loads plaintext from disk", async () => {
    // Reason: codex review #3235563049 — when `_keychainOnly: true` is set
    // but SecretStorage is unavailable on this build, the early disk-mode
    // bypass used to call `loadSecretsFromDisk()` and surface any stale
    // plaintext (cross-version sync, manual edits) for the session. That
    // breaks the keychain-only contract enforced everywhere else in this
    // module. The fix strips secret fields and preserves `_keychainOnly`.
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });

    const loaded = await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        _keychainOnly: true,
        openAIApiKey: "sk-disk-leak",
        activeModels: [makeModel({ apiKey: "sk-model-leak" })],
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    const rec = loaded as unknown as Record<string, unknown>;
    expect(rec._keychainOnly).toBe(true);
    expect(loaded.openAIApiKey).toBe("");
    expect(loaded.activeModels[0].apiKey).toBe("");
  });

  it("migrates legacy _diskSecretsCleared → _keychainOnly via cleanupLegacyFields", async () => {
    const { mod } = await loadModule();

    const loaded = await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        _diskSecretsCleared: true,
      } as unknown as Partial<CopilotSettings>),
      jest.fn().mockResolvedValue(undefined)
    );

    const rec = loaded as unknown as Record<string, unknown>;
    expect(rec._keychainOnly).toBe(true);
    expect(rec._diskSecretsCleared).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// persistSettings — branch dispatch
// ---------------------------------------------------------------------------

describe("persistSettings", () => {
  it("keychain-only branch writes keychain and strips disk", async () => {
    const { mod, keychain, mockSettings } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mockSettings.current = makeSettings({
      openAIApiKey: "sk-123",
      _keychainOnly: true,
    });

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    await mod.persistSettings(mockSettings.current, saveData, mockSettings.current);
    await mod.flushPersistence();

    expect(keychain.setSecretById).toHaveBeenCalledWith("kc-openai", "sk-123");
    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.openAIApiKey).toBe("");
    expect(saved._keychainOnly).toBe(true);
  });

  it("disk branch writes plaintext to disk and never touches the keychain", async () => {
    // Reason: scenario "disk mode completely bypasses secretStorage" — important
    // for users who never opted in. Even if a stale keychain entry exists, we
    // must not read or write it.
    const { mod, keychain } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    const current = makeSettings({ openAIApiKey: "sk-plaintext" });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({ openAIApiKey: "sk-plaintext" })
    );
    expect(keychain.setSecretById).not.toHaveBeenCalled();
    expect(keychain.persistSecrets).not.toHaveBeenCalled();
    expect(keychain.getSecret).not.toHaveBeenCalled();
  });

  it("falls back to plaintext disk save when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    const current = makeSettings({ openAIApiKey: "sk-fallback" });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ openAIApiKey: "sk-fallback" }));
  });

  it("preserves _keychainOnly and strips secrets when keychain is unavailable", async () => {
    // Reason: a keychain-only vault opened on a non-SecretStorage build must
    // NOT downgrade to disk mode and write plaintext — that would silently
    // orphan the keychain entries on other devices when the vault syncs back.
    // Instead, preserve the mode marker and strip secrets so the next device
    // with Secure Storage support can resume normally.
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });
    const saveData = jest.fn().mockResolvedValue(undefined);

    const current = makeSettings({
      openAIApiKey: "sk-fallback",
      _keychainOnly: true,
    });
    await mod.persistSettings(current, saveData, current);
    await mod.flushPersistence();

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._keychainOnly).toBe(true);
    expect(saved.openAIApiKey).toBe("");
  });

  it("does not roll memory back when saveData fails", async () => {
    const { mod, mockSettings, keychain } = await loadModule();
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-123",
      _keychainOnly: true,
    });

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-123"]],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockRejectedValue(new Error("disk full"));

    await expect(
      mod
        .persistSettings(mockSettings.current, saveData, mockSettings.current)
        .then(() => mod.flushPersistence())
    ).rejects.toThrow("disk full");
  });

  it("after migrate, subsequent persist never writes plaintext secret to disk", async () => {
    const { mod, keychain, mockSettings } = await loadModule();
    const saveData = jest.fn().mockResolvedValue(undefined);

    mockSettings.current = makeSettings({
      openAIApiKey: "plaintext-still-in-memory",
      _keychainOnly: true,
    });

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "plaintext-still-in-memory"]],
      keychainIdsToDelete: [],
    });

    await mod.persistSettings(mockSettings.current, saveData, mockSettings.current);
    await mod.flushPersistence();

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    // Reason: even though memory holds the plaintext, the on-disk payload must
    // have the secret stripped — this is the keychain-only contract.
    expect(saved.openAIApiKey).toBe("");
  });
});

// ---------------------------------------------------------------------------
// migrateDiskSecretsToKeychain
// ---------------------------------------------------------------------------

describe("migrateDiskSecretsToKeychain", () => {
  it("writes keychain, strips disk, and flips memory to _keychainOnly=true", async () => {
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({
      openAIApiKey: "sk-live",
      anthropicApiKey: "sk-ant",
    });

    // Seed cached disk-secret state via loadSettingsWithKeychain
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [
        ["kc-openai", "sk-live"],
        ["kc-anthropic", "sk-ant"],
      ],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    await mod.migrateDiskSecretsToKeychain(saveData);

    expect(keychain.setSecretById).toHaveBeenCalledWith("kc-openai", "sk-live");
    expect(keychain.setSecretById).toHaveBeenCalledWith("kc-anthropic", "sk-ant");

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._keychainOnly).toBe(true);
    expect(saved.openAIApiKey).toBe("");
    expect(saved.anthropicApiKey).toBe("");

    expect((mockSettings.current as unknown as Record<string, unknown>)._keychainOnly).toBe(true);
  });

  it("refuses to migrate when keychain is unavailable", async () => {
    const { mod, mockSettings } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });

    const saveData = jest.fn().mockResolvedValue(undefined);
    await expect(mod.migrateDiskSecretsToKeychain(saveData)).rejects.toThrow(
      /Cannot migrate to Obsidian Keychain/
    );
    expect(saveData).not.toHaveBeenCalled();
  });

  it("partial migration: clears undecryptable enc_* fields and reports them", async () => {
    // Reason: a stale device-local crypto key can leave enc_* values that the
    // current device cannot decrypt. Migration must not write that ciphertext
    // into the keychain (where it would silently break LLM calls). Instead it
    // clears those fields and tells the caller exactly which keys to re-enter.
    //
    // DESIGN NOTE — this asserts the partial-success contract on purpose. Do
    // NOT "fix" the implementation to throw on undecryptable fields; the
    // multi-device re-entry trade-off is already disclosed in the migration
    // modal, and partial-success has identical end state with fewer user
    // steps. See the note on `collectUndecryptableFields` in the implementation.
    const { mod, keychain, mockSettings } = await loadModule({
      // Reason: simulate decrypt failure for any enc_* value.
      getDecryptedKey: async () => "",
    });
    mockSettings.current = makeSettings({
      openAIApiKey: "enc_desk_broken",
      anthropicApiKey: "sk-ant",
      activeModels: [makeModel({ name: "gpt-4", provider: "openai", apiKey: "enc_desk_broken" })],
    });

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "enc_desk_broken",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-anthropic", "sk-ant"]],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    const result = await mod.migrateDiskSecretsToKeychain(saveData);

    expect(result.fieldsRequiringReentry).toEqual(
      expect.arrayContaining(["openAIApiKey", "gpt-4 (openai) apiKey"])
    );
    expect(result.fieldsRequiringReentry).toHaveLength(2);

    // Reason: ciphertext must NEVER be written to the keychain, even partially.
    expect(keychain.setSecretById).not.toHaveBeenCalledWith(expect.anything(), "enc_desk_broken");

    const saved = saveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._keychainOnly).toBe(true);
    expect(saved.openAIApiKey).toBe("");

    // Reason: the readable field still got migrated successfully.
    expect(keychain.setSecretById).toHaveBeenCalledWith("kc-anthropic", "sk-ant");
  });

  it("propagates saveData errors and does not flip the memory flag", async () => {
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });

    // Seed disk-secret state
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockRejectedValue(new Error("disk full"));
    await expect(mod.migrateDiskSecretsToKeychain(saveData)).rejects.toThrow("disk full");

    // Reason: memory flag must NOT advance when the transaction failed.
    expect(
      (mockSettings.current as unknown as Record<string, unknown>)._keychainOnly
    ).toBeUndefined();
  });

  it("lifts the fail-closed lock after a rollback-clean transient failure so retry works", async () => {
    // Reason: codex review #3234543430 — a transient saveData failure used to
    // wedge `persistHadUndecryptableSecrets = true` forever, blocking every
    // subsequent migration attempt until Obsidian was restarted. The fix
    // resets the lock when the rollback proves the keychain is back in a
    // known-good state. This test pins that the user can retry without a
    // restart.
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });

    // First attempt: saveData throws. Rollback writes succeed (the default
    // setSecretById mock returns undefined), so the lock should be lifted.
    const failingSaveData = jest.fn().mockRejectedValue(new Error("transient io"));
    await expect(mod.migrateDiskSecretsToKeychain(failingSaveData)).rejects.toThrow("transient io");

    expect(mod.canClearDiskSecrets(mockSettings.current)).toBe(true);

    // Second attempt: saveData succeeds. Migration completes normally.
    const goodSaveData = jest.fn().mockResolvedValue(undefined);
    await mod.migrateDiskSecretsToKeychain(goodSaveData);

    const saved = goodSaveData.mock.calls[0][0] as Record<string, unknown>;
    expect(saved._keychainOnly).toBe(true);
    expect((mockSettings.current as unknown as Record<string, unknown>)._keychainOnly).toBe(true);
  });

  it("keeps the fail-closed lock when rollback itself fails", async () => {
    // Reason: rollback writes the previous settings' secrets back to keychain.
    // If those writes also fail, keychain state is unknown — leave the lock
    // armed so a subsequent retry doesn't strip disk against a possibly
    // corrupt keychain.
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });
    // Reason: every keychain write throws — both the forward write and the
    // rollback replay. The rollback helper must report failure so the lock
    // stays armed.
    keychain.setSecretById.mockImplementation(() => {
      throw new Error("keychain locked");
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    await expect(mod.migrateDiskSecretsToKeychain(saveData)).rejects.toThrow("keychain locked");

    expect(mod.canClearDiskSecrets(mockSettings.current)).toBe(false);
  });

  it("preserves concurrent settings edits committed during the migration await", async () => {
    // Reason: codex review surfaced a race in the migration transaction. The
    // transaction captured `current` at start, but `setSettings(target)` at
    // the end committed that stale snapshot wholesale, silently rolling back
    // any unrelated edits (theme toggle, prompt change, etc.) the user made
    // while keychain writes + saveData were in flight. The fix re-derives
    // the in-memory commit from the latest `getSettings()` snapshot so only
    // migration-owned fields (`_keychainOnly: true` plus `enc_*` clears) are
    // forced, and concurrent edits survive into memory.
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });

    // Hold the FIRST saveData open so we can simulate a concurrent setSettings
    // while the migration transaction is mid-flight. Later saveData calls
    // (the reconciliation re-persist) resolve immediately.
    let resolveFirstSave!: () => void;
    const saveData = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveFirstSave = r;
          })
      )
      .mockResolvedValue(undefined);

    const migration = mod.migrateDiskSecretsToKeychain(saveData);

    // Yield so the transaction reaches its first `await persistSecretsToKeychain`.
    await Promise.resolve();
    await Promise.resolve();

    // Concurrent unrelated edit lands in memory while the transaction awaits.
    (mockSettings.current as unknown as Record<string, unknown>).temperature = 0.99;

    resolveFirstSave();
    await migration;
    await mod.flushPersistence();

    const final = mockSettings.current as unknown as Record<string, unknown>;
    expect(final._keychainOnly).toBe(true);
    expect(final.temperature).toBe(0.99); // concurrent edit survives in memory

    // Reason: the reconciliation re-persist must also push the concurrent edit
    // to disk so a user who closes Obsidian immediately afterwards does not
    // lose it. The very last saveData call carries the merged state.
    expect(saveData).toHaveBeenCalledTimes(2);
    const lastDiskPayload = saveData.mock.calls[saveData.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    expect(lastDiskPayload._keychainOnly).toBe(true);
    expect(lastDiskPayload.temperature).toBe(0.99);
  });

  it("syncs memory to target when reconciliation persist fails after a successful first save", async () => {
    // Reason: codex 3rd review surfaced a split-brain risk. If a concurrent
    // edit triggers a reconciliation re-persist and THAT throws, the first
    // save has already committed `target` durably to disk + keychain. Memory
    // would otherwise stay as the pre-migration disk-mode snapshot, and the
    // user's very next settings change would dispatch through
    // `persistSecretsToDisk` — silently writing plaintext secrets back into
    // `data.json` and undoing the successful migration. The fix forces memory
    // to `target` on reconciliation failure so subsequent saves stay on the
    // keychain-only path.
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });

    // First save resolves (migration step 1 commits target). Second save
    // (reconciliation) rejects.
    let resolveFirstSave!: () => void;
    const saveData = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveFirstSave = r;
          })
      )
      .mockRejectedValueOnce(new Error("reconcile io"));

    const migration = mod.migrateDiskSecretsToKeychain(saveData);

    await Promise.resolve();
    await Promise.resolve();

    // Concurrent edit forces the reconciliation pass to run.
    (mockSettings.current as unknown as Record<string, unknown>).temperature = 0.42;

    resolveFirstSave();

    await expect(migration).rejects.toThrow("reconcile io");
    await mod.flushPersistence();

    const final = mockSettings.current as unknown as Record<string, unknown>;
    // Migration's first save IS durable; memory must match so the next save
    // stays on the keychain-only path and does not regress to disk mode.
    // (Plaintext stays in memory for runtime LLM use — disk is the stripped
    // copy, keychain holds the durable secret.)
    expect(final._keychainOnly).toBe(true);
    // The concurrent temperature edit is intentionally rolled back so memory
    // matches what `target` actually persisted; preserving the migration
    // safety invariant takes priority over preserving the concurrent edit.
    expect(final.temperature).not.toBe(0.42);
  });

  it("successful disk-mode save lifts the fail-closed lock so migration retry works", async () => {
    // Reason: codex review #3235793522 — when a migration attempt suffers a
    // double failure (forward keychain write fails AND rollback also fails),
    // `persistHadUndecryptableSecrets` stays armed. The conditional reset in
    // `persistSecretsToKeychain` only fires when rollback succeeded. Without
    // also resetting the lock on successful disk-mode saves, the user was
    // trapped until Obsidian restart: `canClearDiskSecrets()` kept returning
    // false, so the Migrate flow rejected every retry with "last save did
    // not complete safely". The fix clears the lock at the end of a clean
    // disk save — disk is the source of truth again, so a fresh migration
    // attempt would copy from the known-good baseline.
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({ openAIApiKey: "sk-live" });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "sk-live"]],
      keychainIdsToDelete: [],
    });

    // Step 1: force the double-failure so the lock arms.
    keychain.setSecretById.mockImplementation(() => {
      throw new Error("keychain locked");
    });
    await expect(
      mod.migrateDiskSecretsToKeychain(jest.fn().mockResolvedValue(undefined))
    ).rejects.toThrow("keychain locked");
    expect(mod.canClearDiskSecrets(mockSettings.current)).toBe(false);

    // Step 2: the user fixes whatever was wrong and edits any setting →
    // settings subscriber triggers a normal disk-mode persist.
    keychain.setSecretById.mockReset();
    keychain.setSecretById.mockReturnValue(undefined);
    const cleanSave = jest.fn().mockResolvedValue(undefined);
    await mod.persistSettings(
      mockSettings.current,
      cleanSave,
      mockSettings.current
    );
    await mod.flushPersistence();

    // Step 3: the lock must be lifted so the next migration attempt can run.
    expect(mod.canClearDiskSecrets(mockSettings.current)).toBe(true);
  });

  it("undecryptable enc_* in keychain entries throws BEFORE arming the fail-closed lock", async () => {
    // Reason: the defensive `hasEncryptionPrefix` guard rejects writes before
    // we touch the keychain or disk, so it must not poison the migration
    // retry path. (Today this branch is hard to reach since the migrate path
    // calls collectUndecryptableFields() first and throws earlier; this test
    // pins the contract for any other caller that goes through
    // persistSettings -> persistSecretsToKeychain directly.)
    const { mod, keychain, mockSettings } = await loadModule();
    mockSettings.current = makeSettings({
      _keychainOnly: true,
      openAIApiKey: "enc_garbled",
    });
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "enc_garbled",
        _keychainOnly: true,
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    keychain.persistSecrets.mockReturnValue({
      secretEntries: [["kc-openai", "enc_garbled"]],
      keychainIdsToDelete: [],
    });

    const saveData = jest.fn().mockResolvedValue(undefined);
    await expect(
      mod.persistSettings(mockSettings.current, saveData)
    ).rejects.toThrow(/undecryptable secrets/);
    await mod.flushPersistence();

    expect(keychain.setSecretById).not.toHaveBeenCalled();
    expect(saveData).not.toHaveBeenCalled();
    // The lock must NOT be left armed by a guard that ran before any write.
    // canClearDiskSecrets returns false here for a different reason
    // (isKeychainOnly), so we test the lock directly by reading the exposed
    // helper through a disk-mode probe.
    expect(
      mod.canClearDiskSecrets(makeSettings({ openAIApiKey: "sk-live" }))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasDiskSecretsToMigrate / canClearDiskSecrets
// ---------------------------------------------------------------------------

describe("hasDiskSecretsToMigrate", () => {
  it("returns true when disk has secrets after load", async () => {
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    expect(mod.hasDiskSecretsToMigrate()).toBe(true);
  });

  it("returns false on a fresh install (no disk file)", async () => {
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(null, jest.fn().mockResolvedValue(undefined));

    expect(mod.hasDiskSecretsToMigrate()).toBe(false);
  });
});

describe("canClearDiskSecrets", () => {
  it("returns true when keychain available, disk has secrets, not yet keychain-only", async () => {
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    expect(mod.canClearDiskSecrets(makeSettings({ openAIApiKey: "sk-live" }))).toBe(true);
  });

  it("returns false once _keychainOnly is true", async () => {
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-live",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    expect(
      mod.canClearDiskSecrets(
        makeSettings({ _keychainOnly: true })
      )
    ).toBe(false);
  });

  it("returns false when keychain is unavailable", async () => {
    const { mod } = await loadModule({
      keychain: { isAvailable: jest.fn().mockReturnValue(false) },
    });

    expect(mod.canClearDiskSecrets(makeSettings({ openAIApiKey: "sk-live" }))).toBe(false);
  });

  it("returns false when disk has no secrets", async () => {
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(null, jest.fn().mockResolvedValue(undefined));

    expect(mod.canClearDiskSecrets(makeSettings())).toBe(false);
  });

  it("returns true when disk has no secrets but the user just typed one into memory", async () => {
    // Reason: covers the in-memory fallback. `hasDiskSecretsToMigrate()` only
    // refreshes after a persist, so a fresh install where the user just typed
    // their first key needs the live-settings presence check to surface the
    // "Migrate to Keychain" CTA without waiting for the next save.
    const { mod } = await loadModule();
    await mod.loadSettingsWithKeychain(null, jest.fn().mockResolvedValue(undefined));

    expect(mod.hasDiskSecretsToMigrate()).toBe(false);
    expect(mod.canClearDiskSecrets(makeSettings({ openAIApiKey: "sk-live" }))).toBe(true);
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
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    const saveData = jest.fn().mockResolvedValue(undefined);

    await mod.runPersistenceTransaction(async () => {
      const stale = makeSettings({ openAIApiKey: "sk-live" });
      // Reason: fire-and-forget on purpose — the test asserts a persist queued
      // mid-transaction is dropped, so we must NOT await it here.
      void mod.persistSettings(stale, saveData, stale);
    });

    await mod.flushPersistence();

    expect(saveData).not.toHaveBeenCalled();
  });

  it("skips persist queued during a FAILED transaction", async () => {
    const { mod } = await loadModule();

    await mod.loadSettingsWithKeychain(
      makeSettings({
        _keychainVaultId: "vault1234",
      }),
      jest.fn().mockResolvedValue(undefined)
    );

    const saveData = jest.fn().mockResolvedValue(undefined);

    await mod
      .runPersistenceTransaction(async () => {
        const stale = makeSettings({ openAIApiKey: "sk-live" });
        // Reason: fire-and-forget on purpose — the test asserts a persist queued
        // inside a failed transaction is dropped, so we must NOT await it here.
        void mod.persistSettings(stale, saveData, stale);
        throw new Error("simulated transaction failure");
      })
      .catch(() => {
        /* expected */
      });

    await mod.flushPersistence();

    expect(saveData).not.toHaveBeenCalled();
  });
});
