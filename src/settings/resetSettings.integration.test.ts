/**
 * Integration coverage for `resetSettings()` across the persistence cycle,
 * required by issue #259: credentials must stay reachable "through persistence
 * and a subsequent hydration cycle", not merely in the settings object reset
 * hands back.
 *
 * These cases live outside `model.test.ts` because of a test-lifecycle
 * constraint that file cannot meet: they drive the REAL `KeychainService`
 * (map-backed `app.secretStorage`) and the real persistence module, whose
 * module-level state (`lastPersistedSettings`, the write queue) must be reset
 * per case via `resetPersistenceState()`. `model.test.ts` observes only the
 * in-memory half of reset.
 */

import type { App } from "obsidian";

import { BUILTIN_CHAT_MODELS, DEFAULT_SETTINGS } from "@/constants";
import { KeychainService } from "@/services/keychainService";
import {
  loadSettingsWithKeychain,
  persistSettings,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import type { CustomModel } from "@/aiParams";
import type { Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { getSettings, resetSettings, settingsAtom, settingsStore } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Polyfill structuredClone for jsdom
if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

/** These tests seed post-v4 settings, so the legacy backup never applies. */
const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

const VAULT_ID = "a1b2c3d4";
const BYOK_POINTER = `copilot-v${VAULT_ID}-provider-byok_openai`;
const PLUS_POINTER = `copilot-v${VAULT_ID}-provider-plus_1`;

let secrets: Map<string, string>;
let app: App;

function makeApp(): App {
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    // No base path: the service takes the explicit `setVaultId` below.
    vault: { adapter: {} },
  } as unknown as App;
}

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    providerId: "byok_openai",
    providerType: "openai-compatible",
    displayName: "My OpenAI",
    origin: { kind: "byok" },
    addedAt: 0,
    requiresApiKey: true,
    ...overrides,
  };
}

describe("model", () => {
  describe("resetSettings()", () => {
    beforeEach(() => {
      secrets = new Map();
      app = makeApp();
      resetPersistenceState();
      KeychainService.resetInstance();
      KeychainService.getInstance(app).setVaultId(VAULT_ID);
    });

    it("keeps every credential — top-level, builtin/custom model, BYOK and signed-in Plus provider — reachable through reset, persistence, and a fresh hydration cycle (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", async () => {
      const builtin = BUILTIN_CHAT_MODELS[0];
      const builtinRow: CustomModel = {
        name: builtin.name,
        provider: builtin.provider,
        apiKey: "sk-builtin-override",
        baseUrl: "https://proxy.example.test/v1",
        enabled: false,
        temperature: 0.9,
      };
      const customRow: CustomModel = {
        name: "custom-gpt",
        provider: "openai",
        apiKey: "sk-model-key",
        baseUrl: "http://localhost:9999/v1",
        enabled: true,
      };
      // Provider secrets are written by `ProviderRegistry.setApiKey`, outside
      // the persist path — seed this device's entries directly.
      secrets.set(BYOK_POINTER, "sk-provider-key");
      secrets.set(PLUS_POINTER, "lic-12345");

      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        _keychainVaultId: VAULT_ID,
        openAIApiKey: "sk-top-level",
        azureOpenAIApiInstanceName: "my-instance",
        isPaidUser: true,
        plusLicenseKey: "lic-12345",
        entitlementToken: "test-stale-entitlement-token",
        autoAcceptEdits: true,
        activeModels: [builtinRow, customRow],
        providers: {
          byok_openai: makeProvider({ apiKeyKeychainId: BYOK_POINTER }),
          plus_1: makeProvider({
            providerId: "plus_1",
            displayName: "Copilot",
            origin: { kind: "copilot-plus" },
            requiresApiKey: false,
            apiKeyKeychainId: PLUS_POINTER,
          }),
        },
        configuredModels: [
          {
            configuredModelId: "cm-1",
            providerId: "byok_openai",
            info: { id: "gpt-4", displayName: "GPT-4" },
            configuredAt: 0,
          },
        ],
      });

      // Baseline persist: the real service moves the seeded plaintext secrets
      // into the keychain, as a running session would have before reset.
      await persistSettings(getSettings(), async () => {});

      resetSettings();

      let savedToDisk: CopilotSettings | undefined;
      await persistSettings(getSettings(), async (data) => {
        savedToDisk = structuredClone(data);
      });

      // data.json never carries plaintext in keychain-only mode, and the
      // keychain namespace plus the provider pointer survive the reset write.
      expect(savedToDisk?.openAIApiKey).toBe("");
      expect(savedToDisk?.activeModels.find((m) => m.name === "custom-gpt")?.apiKey).toBe("");
      expect(savedToDisk?._keychainVaultId).toBe(VAULT_ID);
      expect(savedToDisk?.providers.byok_openai?.apiKeyKeychainId).toBe(BYOK_POINTER);

      // Fresh service instance = the next launch on this device.
      KeychainService.resetInstance();
      KeychainService.getInstance(app);
      const reloaded = await loadSettingsWithKeychain(
        app,
        savedToDisk,
        async () => {},
        noLegacyBackup
      );

      // Reload adopted the persisted namespace, not a re-derived one.
      expect(KeychainService.getInstance(app).getVaultId()).toBe(VAULT_ID);

      // Top-level credential and its vendor routing survive; preferences reset.
      expect(reloaded.openAIApiKey).toBe("sk-top-level");
      expect(reloaded.azureOpenAIApiInstanceName).toBe("my-instance");
      expect(reloaded.autoAcceptEdits).toBe(DEFAULT_SETTINGS.autoAcceptEdits);

      // Builtin row: key + endpoint kept, preferences back to defaults.
      const reloadedBuiltin = reloaded.activeModels.find((m) => m.name === builtin.name);
      expect(reloadedBuiltin?.apiKey).toBe("sk-builtin-override");
      expect(reloadedBuiltin?.baseUrl).toBe("https://proxy.example.test/v1");
      expect(reloadedBuiltin?.enabled).toBe(true);
      expect(reloadedBuiltin?.temperature).toBeUndefined();

      // Custom row survives whole.
      const reloadedCustom = reloaded.activeModels.find((m) => m.name === "custom-gpt");
      expect(reloadedCustom?.apiKey).toBe("sk-model-key");
      expect(reloadedCustom?.baseUrl).toBe("http://localhost:9999/v1");

      // BYOK provider row, its keychain entry, and its configured model stay
      // reachable.
      expect(reloaded.providers.byok_openai?.apiKeyKeychainId).toBe(BYOK_POINTER);
      expect(secrets.get(BYOK_POINTER)).toBe("sk-provider-key");
      expect(reloaded.configuredModels.map((m) => m.configuredModelId)).toEqual(["cm-1"]);

      // Signed-in Plus: paid state and the provider row survive so the
      // settings subscriber never reads reset as sign-out; the entitlement
      // token still resets (its identity binding is invalidated).
      expect(reloaded.isPaidUser).toBe(true);
      expect(reloaded.plusLicenseKey).toBe("lic-12345");
      expect(reloaded.providers.plus_1?.apiKeyKeychainId).toBe(PLUS_POINTER);
      expect(secrets.get(PLUS_POINTER)).toBe("lic-12345");
      expect(reloaded.entitlementToken).toBe(DEFAULT_SETTINGS.entitlementToken);
    });
  });
});
