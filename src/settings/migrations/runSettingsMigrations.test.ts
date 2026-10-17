import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_COPILOT_FOLDER, DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi, ProviderType } from "@/modelManagement";
import { getSettings, settingsAtom, settingsStore, type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "./index";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn(() => ({ isAvailable: () => false })) },
}));

function seedVault(
  overrides: Partial<CopilotSettings> & Record<string, unknown>,
  models: CustomModel[] = []
): CopilotSettings {
  const seeded: CopilotSettings = { ...DEFAULT_SETTINGS, activeModels: models, ...overrides };
  settingsStore.set(settingsAtom, seeded);
  return seeded;
}

function makeApi() {
  const setupProvider = jest.fn(async () => ({ providerId: "p1", configuredModelIds: ["cm1"] }));
  const removeProvider = jest.fn(async () => undefined);
  const api = {
    providerRegistry: { listByOrigin: jest.fn(() => []) },
    setup: { byok: { setupProvider } },
    coordinator: { removeProvider },
  } as unknown as ModelManagementApi;
  return { api, setupProvider, removeProvider };
}

function keyedAnthropicVault(settingsVersion: number | undefined): CopilotSettings {
  return seedVault({ settingsVersion, anthropicApiKey: "sk-ant" }, [
    {
      name: "claude-sonnet-4-5",
      provider: ChatModelProviders.ANTHROPIC,
      enabled: true,
      isBuiltIn: false,
    },
  ]);
}

function codexVaultAt(settingsVersion: number): CopilotSettings {
  return seedVault({
    settingsVersion,
    providers: {
      "prov-codex": {
        providerId: "prov-codex",
        providerType: "openai-compatible",
        displayName: "Codex",
        origin: { kind: "agent", agentType: "codex" },
        addedAt: 0,
      },
    },
    configuredModels: ["low", "high"].map((effort) => ({
      configuredModelId: `cm-${effort}`,
      providerId: "prov-codex",
      info: { id: `gpt-5.6-sol[${effort}]`, displayName: `GPT-5.6-Sol (${effort})` },
      configuredAt: 0,
    })),
    backends: { codex: { enabledModels: ["cm-high"] } },
  });
}

describe("settingsMigrations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
  });

  describe("runSettingsMigrations()", () => {
    it("migrates legacy BYOK models and stamps the current version for a pre-versioned install", async () => {
      keyedAnthropicVault(undefined);
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).toHaveBeenCalledTimes(1);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("migrates legacy BYOK models for a vault stamped with the orphaned prototype version 2", async () => {
      keyedAnthropicVault(2);
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).toHaveBeenCalledTimes(1);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("stamps the current version even when there is nothing to migrate", async () => {
      seedVault({ settingsVersion: undefined });
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).not.toHaveBeenCalled();
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("backfills requiresApiKey for a v4 vault without re-running the legacy BYOK migration", async () => {
      seedVault({
        settingsVersion: 4,
        providers: {
          p1: {
            providerId: "p1",
            providerType: "openai-compatible",
            displayName: "OpenRouter",
            origin: { kind: "byok", catalogProviderId: "openrouter" },
            addedAt: 0,
            apiKeyKeychainId: null,
          },
        },
      });
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).not.toHaveBeenCalled();
      expect(getSettings().providers.p1.requiresApiKey).toBe(true);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it.each([CURRENT_SETTINGS_VERSION, CURRENT_SETTINGS_VERSION + 1])(
      "leaves a v%s vault untouched even when it still holds retired provider, model, and Codex data",
      async (settingsVersion) => {
        const codexRows = codexVaultAt(settingsVersion);
        const seeded = seedVault(
          {
            ...codexRows,
            defaultModelKey: "gpt-4o|github-copilot",
            embeddingModelKey: "azure-openai|azure openai",
            providers: {
              ...codexRows.providers,
              bed: {
                providerId: "bed",
                providerType: "bedrock" as ProviderType,
                displayName: "Amazon Bedrock",
                origin: { kind: "byok" },
                addedAt: 0,
              },
            },
          },
          [{ name: "gpt-4o", provider: "github-copilot", enabled: true, isBuiltIn: false }]
        );
        const { api, setupProvider, removeProvider } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings()).toBe(seeded);
        expect(setupProvider).not.toHaveBeenCalled();
        expect(removeProvider).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["plus", false],
      ["miyo", true],
      [undefined, true],
      ["bogus", true],
    ])(
      "v15: maps a v14 vault with docProcessorBackend %s to enableMiyoDocumentProcessing=%s",
      async (docProcessorBackend, expected) => {
        seedVault({ settingsVersion: 14, docProcessorBackend });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().enableMiyoDocumentProcessing).toBe(expected);
      }
    );

    it("v15: keeps the switch the user already set on a v15 vault", async () => {
      seedVault({
        settingsVersion: 15,
        docProcessorBackend: "miyo",
        enableMiyoDocumentProcessing: false,
      });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().enableMiyoDocumentProcessing).toBe(false);
    });

    it("v7: turns the Miyo search skill on for an existing Miyo user", async () => {
      seedVault({ settingsVersion: 6, enableMiyo: true, enableMiyoSearchSkill: undefined });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().enableMiyoSearchSkill).toBe(true);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("v7: keys off persisted enableMiyo, not the mobile-sensitive search backend", async () => {
      (Platform as { isMobile: boolean }).isMobile = true;
      try {
        seedVault({ settingsVersion: 6, enableMiyo: true, enableMiyoSearchSkill: undefined });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().enableMiyoSearchSkill).toBe(true);
      } finally {
        (Platform as { isMobile: boolean }).isMobile = false;
      }
    });

    it.each([true, false])(
      "v16: keeps a connected v15 install's Miyo search switch at %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)",
      async (enableMiyoSearchSkill) => {
        seedVault({ settingsVersion: 15, enableMiyo: true, enableMiyoSearchSkill });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().enableMiyoSearchSkill).toBe(enableMiyoSearchSkill);
        expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
      }
    );

    it("v16: turns the switch on for a v15 install that is not connected and persisted it off (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)", async () => {
      seedVault({ settingsVersion: 15, enableMiyo: false, enableMiyoSearchSkill: false });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().enableMiyoSearchSkill).toBe(true);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it.each([true, false])(
      "v16: leaves the switch off for a vault already on v16 with enableMiyo=%s (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)",
      async (enableMiyo) => {
        seedVault({ settingsVersion: 16, enableMiyo, enableMiyoSearchSkill: false });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().enableMiyoSearchSkill).toBe(false);
      }
    );

    it("v16: turns the switch on for a pre-v7 install that is not connected and never stored it (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)", async () => {
      seedVault({ settingsVersion: 6, enableMiyo: false, enableMiyoSearchSkill: undefined });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().enableMiyoSearchSkill).toBe(true);
    });

    it("v7 then v16: leaves a pre-v7 connected install with the switch on (https://github.com/Brevilabs/obsidian-copilot-private/issues/716)", async () => {
      seedVault({ settingsVersion: 6, enableMiyo: true, enableMiyoSearchSkill: false });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().enableMiyoSearchSkill).toBe(true);
    });

    it.each([7, undefined])(
      "v8: seeds the Copilot root, its history, and the upgrade flag for a settingsVersion=%s vault",
      async (settingsVersion) => {
        seedVault({
          settingsVersion,
          copilotFolder: undefined,
          copilotRootHistory: undefined,
          upgradedToV8FromLegacy: undefined,
        });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().copilotFolder).toBe(DEFAULT_COPILOT_FOLDER);
        expect(getSettings().copilotRootHistory).toEqual([DEFAULT_COPILOT_FOLDER]);
        expect(getSettings().upgradedToV8FromLegacy).toBe(true);
      }
    );

    it("v9: drops GitHub Copilot models and selections for a v8 vault", async () => {
      seedVault({ settingsVersion: 8, defaultModelKey: "gpt-4o|github-copilot" }, [
        { name: "gpt-4o", provider: "github-copilot", enabled: true, isBuiltIn: false },
      ]);
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().activeModels.map((m) => m.provider)).not.toContain("github-copilot");
      expect(getSettings().defaultModelKey).toBe("");
    });

    it("v10: makes auth optional for an existing custom OpenAI-compatible provider (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      seedVault({
        settingsVersion: 9,
        providers: {
          custom: {
            providerId: "custom",
            providerType: "openai-compatible",
            displayName: "Custom OpenAI-compatible",
            origin: { kind: "byok" },
            requiresApiKey: true,
            apiKeyKeychainId: "keychain-custom",
            addedAt: 0,
          },
        },
      });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().providers.custom).toMatchObject({
        requiresApiKey: false,
        apiKeyKeychainId: "keychain-custom",
      });
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("v11: hands a saved Bedrock provider to the removal cascade for a v10 vault", async () => {
      seedVault({
        settingsVersion: 10,
        providers: {
          bed: {
            providerId: "bed",
            providerType: "bedrock" as ProviderType,
            displayName: "Amazon Bedrock",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      });
      const { api, removeProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(removeProvider).toHaveBeenCalledWith("bed");
    });

    it("v12: hands a saved Azure provider to the removal cascade for a v11 vault", async () => {
      seedVault({
        settingsVersion: 11,
        providers: {
          az: {
            providerId: "az",
            providerType: "azure" as ProviderType,
            displayName: "Azure OpenAI",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      });
      const { api, removeProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(removeProvider).toHaveBeenCalledWith("az");
    });

    it("v12: repoints an embedding selection that named Azure for a v11 vault", async () => {
      seedVault({ settingsVersion: 11, embeddingModelKey: "azure-openai|azure openai" });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect((getSettings() as { embeddingModelKey?: string }).embeddingModelKey).toBe("");
    });

    it.each([8, 9, 10, 11, 12, 13])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 v14: collapses a v%s vault's per-effort codex rows and preserves its enabled set",
      async (version) => {
        codexVaultAt(version);
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().configuredModels.map((m) => m.info.id)).toEqual(["gpt-5.6-sol"]);
        expect(getSettings().backends.codex?.enabledModels).toEqual(["cm-low"]);
      }
    );
  });
});
