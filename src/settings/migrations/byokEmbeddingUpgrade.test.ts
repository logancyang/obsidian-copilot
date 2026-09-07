import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import {
  BackendConfigRegistry,
  ByokSetupApi,
  ConfiguredModelRegistry,
  ProviderAdapterRegistry,
  ProviderRegistry,
  type ModelManagementApi,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { getSettings, setSettings } from "@/settings/model";
import type { App } from "obsidian";
import { runSettingsMigrations } from "./index";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

// Separate from runSettingsMigrations.test.ts: that suite mocks settings/model and
// KeychainService at module scope. This lifecycle test requires their real instances
// alongside the real BYOK setup/registries to observe normalized upgrade state.
describe("byokEmbeddingUpgrade", () => {
  describe("runSettingsMigrations()", () => {
    beforeEach(() => KeychainService.resetInstance());
    afterEach(() => KeychainService.resetInstance());
    it("removes legacy-only embeddings and selected aliases while migrating chat and preserving shared credentials (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", async () => {
      const secrets = new Map<string, string>();
      const app = {
        secretStorage: {
          setSecret: (id: string, value: string) => secrets.set(id, value),
          getSecret: (id: string) => secrets.get(id) ?? null,
          listSecrets: () => [...secrets.keys()],
          deleteSecret: (id: string) => secrets.delete(id),
        },
        vault: { adapter: {} },
      } as unknown as App;
      const chat = {
        name: "gpt-4o",
        provider: ChatModelProviders.OPENAI,
        enabled: true,
        apiKey: "shared-chat-key",
      };
      const embedding = {
        name: "text-embedding-3-small",
        provider: ChatModelProviders.OPENAI,
        enabled: true,
        isEmbeddingModel: false,
        apiKey: "shared-chat-key",
      };
      const plus = { name: "embed", provider: ChatModelProviders.COPILOT_PLUS, enabled: true };
      const unknown = { name: "embed", provider: "unknown-agent", enabled: true };
      const removedKey = `${embedding.name}|${embedding.provider}`;
      setSettings({
        ...DEFAULT_SETTINGS,
        settingsVersion: 3,
        activeModels: [chat, embedding, plus, unknown],
        openAIApiKey: "top-level-key",
        providers: {},
        configuredModels: [],
        backends: {},
        defaultModelKey: removedKey,
        quickCommandModelKey: removedKey,
        projectList: [
          {
            id: "project",
            name: "Project",
            systemPrompt: "",
            projectModelKey: removedKey,
            modelConfigs: {},
            contextSource: {},
            created: 0,
            UsageTimestamps: 0,
          },
        ],
      });
      const legacyBefore = getSettings().activeModels;
      const providers = new ProviderRegistry(app, new ProviderAdapterRegistry());
      const models = new ConfiguredModelRegistry();
      const backends = new BackendConfigRegistry(providers, models);
      const byok = new ByokSetupApi(providers, models, backends);
      const removeProvider = jest.fn();
      await runSettingsMigrations({
        providerRegistry: providers,
        configuredModelRegistry: models,
        backendConfigRegistry: backends,
        setup: { byok },
        coordinator: { removeProvider },
      } as unknown as ModelManagementApi);
      const after = getSettings();
      // The inline editor's fallback picker consumes this legacy list directly.
      expect(after.activeModels).toEqual(
        legacyBefore.filter((model) => model.name !== embedding.name)
      );
      expect(after.activeModels).toEqual(expect.arrayContaining([chat, plus, unknown]));
      expect(after.defaultModelKey).toBe("");
      expect(after.quickCommandModelKey).toBeUndefined();
      expect(after.projectList[0].projectModelKey).toBe("");
      const migratedChat = after.configuredModels.find((model) => model.info.id === chat.name)!;
      expect(migratedChat).toBeDefined();
      expect(after.configuredModels.some((model) => model.info.id === embedding.name)).toBe(false);
      expect(after.backends.chat?.enabledModels).toContain(migratedChat.configuredModelId);
      expect(after.openAIApiKey).toBe("top-level-key");
      expect(await providers.getApiKey(migratedChat.providerId)).toBe("shared-chat-key");
      expect(removeProvider).not.toHaveBeenCalled();
      expect(after.settingsVersion).toBe(14);
      await runSettingsMigrations({} as ModelManagementApi);
      expect(getSettings()).toBe(after);
    });
  });
});
