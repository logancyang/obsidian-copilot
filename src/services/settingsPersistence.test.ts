import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import type { CopilotSettings } from "@/settings/model";

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

async function loadModule(overrides: Record<string, unknown> = {}) {
  jest.resetModules();

  const provider = {
    providerId: "byok-provider",
    providerType: "openai-compatible",
    displayName: "OpenAI",
    origin: { kind: "byok", catalogProviderId: "openai" },
    addedAt: 0,
    apiKeyKeychainId: "copilot-vabcd1234-provider-byok-provider",
  } as CopilotSettings["providers"][string];
  const resetSnapshot = makeSettings({
    openAIApiKey: "preserved-key",
    providers: { [provider.providerId]: provider },
    _keychainVaultId: "abcd1234",
    settingsVersion: 0,
  });
  const settingsModel = {
    createResetSettingsSnapshot: jest.fn(() => resetSnapshot),
    getSettings: jest.fn(() => resetSnapshot),
    setSettings: jest.fn(),
  };

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
  const notice = jest.fn();

  jest.doMock("obsidian", () => ({ Notice: notice }));
  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
  }));
  jest.doMock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock("@/settings/model", () => ({
    ...settingsModel,
    getModelKeyFromModel: (model: { name: string; provider: string }) =>
      `${model.name}|${model.provider}`,
    normalizeModelProvider: (provider: string) =>
      provider === "azure_openai" ? "azure openai" : provider,
    sanitizeSettings: jest.fn((settings: CopilotSettings) => settings),
  }));

  const module = await import("@/services/settingsPersistence");
  return { module, keychain, notice, resetSnapshot, settingsModel };
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

  describe("getLegacyByokCredentialPresence()", () => {
    it("separates provider-wide and model-specific identities after disk credentials are discarded", async () => {
      const { module } = await loadModule();

      await module.loadSettingsWithKeychain(
        {
          openAIApiKey: "enc_desk_legacy",
          azureOpenAIApiKey: "azure-disk-key",
          activeModels: [
            { name: "gpt-4o", provider: "openai", apiKey: "model-disk-key" },
            { name: "claude", provider: "anthropic", apiKey: "plaintext-disk-key" },
            { name: "gemini", provider: "google", apiKey: "" },
            { name: "azure-gpt", provider: "azure_openai", apiKey: "" },
          ],
          activeEmbeddingModels: [],
        },
        jest.fn().mockResolvedValue(undefined)
      );

      expect(module.getLegacyByokCredentialPresence()).toEqual({
        providerIds: ["openai", "azure openai"],
        modelIds: ["gpt-4o|openai", "claude|anthropic"],
      });

      module.resetPersistenceState();
      expect(module.getLegacyByokCredentialPresence()).toEqual({
        providerIds: [],
        modelIds: [],
      });
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
        {
          _keychainVaultId: "1234abcd",
          _keychainOnly: false,
          openAIApiKey: "enc_desk_legacy",
          activeModels: [{ name: "custom", provider: "openai", apiKey: "plaintext-disk-key" }],
          activeEmbeddingModels: [],
          agentMode: {
            byok: { anthropic: "nested-disk-key" },
            mcpServers: [
              {
                id: "server-1",
                transport: "http",
                headers: [{ name: "Authorization", value: "Bearer disk-token" }],
              },
            ],
            backends: {},
          },
        },
        saveData
      );

      const hydrateInput = keychain.hydrateFromKeychain.mock.calls[0][0];
      expect(hydrateInput.openAIApiKey).toBe("");
      expect(hydrateInput.activeModels[0].apiKey).toBe("");
      expect(hydrateInput.agentMode.byok.anthropic).toBe("");
      const hydrateMcpServer = hydrateInput.agentMode.mcpServers[0] as {
        headers: Array<{ value: string }>;
      };
      expect(hydrateMcpServer.headers[0].value).toBe("");
      expect(loaded.openAIApiKey).toBe("keychain-key");
      expect(saveData).toHaveBeenCalledWith(
        expect.objectContaining({
          _keychainVaultId: "1234abcd",
          openAIApiKey: "",
          activeModels: [expect.objectContaining({ apiKey: "" })],
        })
      );
      const savedAgentMode = (saveData.mock.calls[0][0] as unknown as CopilotSettings).agentMode;
      const savedMcpServer = savedAgentMode.mcpServers[0] as {
        headers: Array<{ name: string; value: string }>;
      };
      expect(savedAgentMode.byok).toEqual({ anthropic: "" });
      expect(savedMcpServer.headers).toEqual([{ name: "Authorization", value: "" }]);
      expect(saveData.mock.calls[0][0]).not.toHaveProperty("_keychainOnly");
      expect(module.getLegacyByokCredentialPresence()).toEqual({
        providerIds: ["openai"],
        modelIds: ["custom|openai"],
      });
    });

    it("keeps credentials empty when Keychain is unavailable", async () => {
      const { module, keychain } = await loadModule();
      keychain.isAvailable.mockReturnValue(false);

      const loaded = await module.loadSettingsWithKeychain(
        { _keychainVaultId: "1234abcd", openAIApiKey: "plaintext-disk-key" },
        jest.fn().mockResolvedValue(undefined)
      );

      expect(loaded.openAIApiKey).toBe("");
      expect(keychain.hydrateFromKeychain).not.toHaveBeenCalled();
    });

    it("persists a vault namespace and current schema version for a fresh install", async () => {
      const { module, keychain } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(null, saveData);

      expect(keychain.setVaultId).toHaveBeenCalledWith("abcd1234");
      expect(saveData).toHaveBeenCalledWith({
        _keychainVaultId: "abcd1234",
        settingsVersion: CURRENT_SETTINGS_VERSION,
      });
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

  describe("resetSettingsPreservingKeychain()", () => {
    it("writes stripped defaults and updates memory without diffing Keychain entries", async () => {
      const { module, keychain, resetSnapshot, settingsModel } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await expect(module.resetSettingsPreservingKeychain(saveData)).resolves.toBe(true);
      await module.persistSettings(resetSnapshot, saveData);

      expect(keychain.persistSecrets).not.toHaveBeenCalled();
      expect(keychain.setSecretById).not.toHaveBeenCalled();
      expect(saveData).toHaveBeenCalledTimes(1);
      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
      expect(saveData.mock.calls[0][0]._keychainVaultId).toBe("abcd1234");
      expect(saveData.mock.calls[0][0].settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
      expect(saveData.mock.calls[0][0].providers).toEqual(resetSnapshot.providers);
      expect(settingsModel.setSettings).toHaveBeenCalledWith({
        ...resetSnapshot,
        settingsVersion: CURRENT_SETTINGS_VERSION,
      });
    });

    it("leaves memory and Keychain untouched when the stripped disk save fails", async () => {
      const { module, keychain, notice, settingsModel } = await loadModule();

      const reset = await module.resetSettingsPreservingKeychain(
        jest.fn().mockRejectedValue(new Error("disk unavailable"))
      );

      expect(reset).toBe(false);
      expect(keychain.persistSecrets).not.toHaveBeenCalled();
      expect(keychain.setSecretById).not.toHaveBeenCalled();
      expect(settingsModel.setSettings).not.toHaveBeenCalled();
      expect(notice).toHaveBeenCalledWith(
        "Copilot could not reset settings. Check that the vault is writable, then try again."
      );
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
