/**
 * Integration coverage for `resetSettings()` across the persistence cycle,
 * required by issue #259: credentials must stay reachable "through persistence
 * and a subsequent hydration cycle", not merely in the settings object reset
 * hands back.
 *
 * These cases live outside `model.test.ts` because of a test-lifecycle
 * constraint that file cannot meet: each case re-imports `@/settings/model`
 * and `@/services/settingsPersistence` under a fresh module registry with a
 * fake keychain installed, so reset, save, and hydrate run against one
 * coherent store. `model.test.ts` drives the already-imported singleton and so
 * can only observe the in-memory half.
 */

import { BUILTIN_CHAT_MODELS, DEFAULT_SETTINGS } from "@/constants";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";
import type { CustomModel } from "@/aiParams";
import type { CopilotSettings } from "@/settings/model";
import type { Provider } from "@/modelManagement";

// Polyfill structuredClone for jsdom
if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Fake keychain id for a model row, mirroring the real service's
 * `name|provider` identity scheme closely enough for these tests.
 */
function modelKeychainId(model: Record<string, unknown>): string {
  return `kc-model-${String(model.name)}-${String(model.provider)}`;
}

/** These tests seed post-v4 settings, so the legacy backup never applies. */
const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

function makeSettings(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  const base: CustomModel = {
    name: "gpt-4",
    provider: "openai",
    enabled: true,
  };
  // Only add properties from overrides that are not undefined
  Object.entries(overrides).forEach(([key, value]) => {
    if (value !== undefined) {
      (base as unknown as Record<string, unknown>)[key] = value;
    }
  });
  return base;
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "byok_openai",
    providerType: "openai-compatible",
    displayName: "My OpenAI",
    origin: { kind: "byok" },
    addedAt: Date.now(),
    configuredModels: [],
    ...overrides,
  } as Provider;
}

/** Load a fresh module instance with isolated mocks. */
async function loadModule(overrides?: {
  keychainStore?: Map<string, string>;
  getDecryptedKey?: (value: string) => Promise<string>;
}) {
  jest.resetModules();

  const keychainStore = overrides?.keychainStore ?? new Map<string, string>();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("vault1234"),
    setVaultId: jest.fn(),
    hydrateFromKeychain: jest.fn(async (settings: CopilotSettings) => {
      // Simulate keychain hydration: read secrets from keychainStore
      const hydrated = structuredClone(settings);
      const hydratedRecord = hydrated as unknown as Record<string, unknown>;

      // Hydrate top-level secrets
      for (const key of Object.keys(hydratedRecord)) {
        if (!isSensitiveKey(key)) continue;
        const keychainId = `kc-${key}`;
        const secret = keychainStore.get(keychainId);
        if (secret) {
          hydratedRecord[key] = secret;
        }
      }

      // Hydrate model secrets
      for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
        const models = hydratedRecord[listKey];
        if (!Array.isArray(models)) continue;
        for (const model of models) {
          if (!model || typeof model !== "object") continue;
          const modelRecord = model as Record<string, unknown>;
          const keychainId = modelKeychainId(modelRecord);
          const secret = keychainStore.get(keychainId);
          if (secret) {
            modelRecord.apiKey = secret;
          }
        }
      }

      // Hydrate provider secrets
      const providers = hydratedRecord.providers;
      if (providers && typeof providers === "object") {
        for (const provider of Object.values(providers)) {
          if (!provider || typeof provider !== "object") continue;
          const providerRecord = provider as Record<string, unknown>;
          const keychainId = providerRecord.apiKeyKeychainId;
          if (typeof keychainId === "string" && keychainId.startsWith("kc-")) {
            const secret = keychainStore.get(keychainId);
            if (secret) providerRecord.apiKey = secret;
          }
        }
      }

      return { settings: hydrated, hadFailures: false };
    }),
    persistSecrets: jest.fn((settings: CopilotSettings) => {
      // Simulate keychain persistence: write secrets to keychainStore
      const secretEntries: Array<[string, string]> = [];
      const keychainIdsToDelete: string[] = [];
      const settingsRecord = settings as unknown as Record<string, unknown>;

      // Persist top-level secrets
      for (const key of Object.keys(settingsRecord)) {
        if (!isSensitiveKey(key)) continue;
        const value = settingsRecord[key];
        if (typeof value === "string" && value.length > 0 && !value.startsWith("kc-")) {
          const keychainId = `kc-${key}`;
          keychainStore.set(keychainId, value);
          secretEntries.push([keychainId, value]);
        }
      }

      // Persist model secrets
      for (const listKey of ["activeModels", "activeEmbeddingModels"] as const) {
        const models = settingsRecord[listKey];
        if (!Array.isArray(models)) continue;
        for (const model of models) {
          if (!model || typeof model !== "object") continue;
          const modelRecord = model as Record<string, unknown>;
          const apiKey = modelRecord.apiKey;
          if (typeof apiKey === "string" && apiKey.length > 0 && !apiKey.startsWith("kc-")) {
            const keychainId = modelKeychainId(modelRecord);
            keychainStore.set(keychainId, apiKey);
            secretEntries.push([keychainId, apiKey]);
          }
        }
      }

      // Persist provider secrets
      const providers = settingsRecord.providers;
      if (providers && typeof providers === "object") {
        for (const provider of Object.values(providers)) {
          if (!provider || typeof provider !== "object") continue;
          const providerRecord = provider as Record<string, unknown>;
          const apiKey = providerRecord.apiKey;
          const keychainId = providerRecord.apiKeyKeychainId;
          if (typeof apiKey === "string" && apiKey.length > 0 && typeof keychainId === "string") {
            keychainStore.set(keychainId, apiKey);
            secretEntries.push([keychainId, apiKey]);
          }
        }
      }

      return { secretEntries, keychainIdsToDelete };
    }),
    setSecretById: jest.fn(),
    deleteSecretById: jest.fn(),
    getSecret: jest.fn().mockReturnValue(null),
    getModelSecret: jest.fn().mockReturnValue(null),
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
    // Production `isSecretKey` is `isSensitiveKey` widened by an exception
    // list that is currently empty, so the shared heuristic is a faithful fake.
    isSecretKey: jest.fn((key: string) => isSensitiveKey(key)),
  }));

  jest.doMock("@/logger", () => ({ logWarn: jest.fn(), logError: jest.fn() }));

  // Reason: do NOT mock getSettings/setSettings. `resetSettings()` calls
  // `getSettings()` as a module-internal reference, so a `jest.doMock` on the
  // export table would leave the internal call reading the real jotai store —
  // reset would see the built-in model list instead of the test's setup. Drive
  // the real store instead, which is also what production does.
  const settingsModel = await import("@/settings/model");
  const persistenceModule = await import("@/services/settingsPersistence");

  /** Seed the real settings store, the way production `setSettings` would. */
  const seedSettings = (overrides: Partial<CopilotSettings> = {}): CopilotSettings => {
    settingsModel.settingsStore.set(settingsModel.settingsAtom, makeSettings(overrides));
    return settingsModel.getSettings();
  };

  return { settingsModel, persistenceModule, keychain, keychainStore, seedSettings };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("model", () => {
  describe("resetSettings()", () => {
    it("keeps top-level, per-model, provider credentials, and configured models reachable after a reload", async () => {
      const keychainStore = new Map<string, string>();
      const { settingsModel, persistenceModule, seedSettings } = await loadModule({
        keychainStore,
      });

      seedSettings({
        _keychainVaultId: "vault1234",
        openAIApiKey: "sk-top-level",
        providers: {
          byok_openai: makeProvider({
            providerId: "byok_openai",
            apiKeyKeychainId: "kc-provider-openai",
          }),
        },
        activeModels: [
          makeModel({ name: "custom-gpt", provider: "openai", apiKey: "sk-model-key" }),
        ],
        configuredModels: [
          {
            configuredModelId: "cm-1",
            providerId: "byok_openai",
            info: { id: "gpt-4", displayName: "GPT-4" },
            configuredAt: Date.now(),
          },
        ],
      });
      // The provider secret lives only in the keychain — the row holds a pointer.
      keychainStore.set("kc-provider-openai", "sk-provider-key");

      settingsModel.resetSettings();

      const afterReset = settingsModel.getSettings();
      expect(afterReset.providers.byok_openai?.apiKeyKeychainId).toBe("kc-provider-openai");
      expect(afterReset.activeModels.find((m) => m.name === "custom-gpt")).toBeDefined();
      expect(afterReset.configuredModels.length).toBe(1);
      expect(afterReset.configuredModels[0].configuredModelId).toBe("cm-1");

      let savedToDisk: CopilotSettings | undefined;
      await persistenceModule.persistSettings(afterReset, async (data) => {
        savedToDisk = structuredClone(data);
      });

      // data.json must never carry the plaintext in keychain-only mode.
      expect(savedToDisk?.openAIApiKey).toBe("");
      expect(savedToDisk?.activeModels.find((m) => m.name === "custom-gpt")?.apiKey).toBe("");

      const reloaded = await persistenceModule.loadSettingsWithKeychain(
        savedToDisk,
        async () => {},
        noLegacyBackup
      );

      expect(reloaded.openAIApiKey).toBe("sk-top-level");
      expect(reloaded.activeModels.find((m) => m.name === "custom-gpt")?.apiKey).toBe(
        "sk-model-key"
      );
      expect(reloaded.providers.byok_openai?.apiKeyKeychainId).toBe("kc-provider-openai");
      expect(keychainStore.get("kc-provider-openai")).toBe("sk-provider-key");
      expect(reloaded.configuredModels.length).toBe(1);
      expect(reloaded.configuredModels[0].configuredModelId).toBe("cm-1");
    });

    it("keeps a builtin model's key and endpoint through persistence and reload", async () => {
      const keychainStore = new Map<string, string>();
      const { settingsModel, persistenceModule, seedSettings } = await loadModule({
        keychainStore,
      });

      const builtin = BUILTIN_CHAT_MODELS[0];
      seedSettings({
        _keychainVaultId: "vault1234",
        activeModels: [
          makeModel({
            name: builtin.name,
            provider: builtin.provider,
            apiKey: "sk-builtin-override",
            baseUrl: "https://proxy.example.test/v1",
            enabled: false,
            temperature: 0.9,
          }),
        ],
      });

      settingsModel.resetSettings();

      const afterReset = settingsModel.getSettings();
      const resetRow = afterReset.activeModels.find(
        (m) => m.name === builtin.name && m.provider === builtin.provider
      );
      expect(resetRow?.apiKey).toBe("sk-builtin-override");
      expect(resetRow?.baseUrl).toBe("https://proxy.example.test/v1");
      expect(resetRow?.temperature).toBe(builtin.temperature);

      let savedToDisk: CopilotSettings | undefined;
      await persistenceModule.persistSettings(afterReset, async (data) => {
        savedToDisk = structuredClone(data);
      });

      const reloaded = await persistenceModule.loadSettingsWithKeychain(
        savedToDisk,
        async () => {},
        noLegacyBackup
      );

      const reloadedRow = reloaded.activeModels.find(
        (m) => m.name === builtin.name && m.provider === builtin.provider
      );
      expect(reloadedRow?.apiKey).toBe("sk-builtin-override");
      expect(reloadedRow?.baseUrl).toBe("https://proxy.example.test/v1");
    });
  });
});
